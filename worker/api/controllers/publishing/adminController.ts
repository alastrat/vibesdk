/**
 * Review and moderation for admins: the pending queue, snapshot files,
 * screenshots, approve or reject decisions, and removing a site from Discover.
 */

import { BaseController } from '../baseController';
import type { ApiResponse, ControllerResponse } from '../types';
import type { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';
import { AppService, TemplateService } from '../../../database';
import type { TemplateVersion } from '../../../database/schema';
import {
    canReview,
    isTemplateShotKind,
    parseRejectionReason,
    supersededVersionId,
} from '../../../services/templates/catalog';
import { parseDiscoverRemoval } from '../../../services/templates/reuse';
import { SHOWCASE_REFRESH_BATCH, runShowcaseRefresh } from '../../../services/showcase/showcase-screenshot';
import { refreshShowcaseScreenshot } from '../../../services/showcase/showcase-refresh';
import { decodeText, type TreeFile } from '../../../services/templates/snapshot';
import { readTemplateSnapshot, templateImageResponse } from '../../../services/templates/store';
import { toPendingReview } from './publishingDto';
import type {
    AdminSalesData,
    DiscoverRemovalData,
    DiscoverRemovalRequest,
    PaidVersionActionData,
    PendingReviewsData,
    RejectVersionRequest,
    ReviewVersionFileData,
    ReviewVersionFilesData,
    ShowcaseRefreshData,
} from './types';

const REVIEW_SCREENSHOT_CACHE = 'private, max-age=300';
const NO_LONGER_IN_REVIEW_MESSAGE = 'This version is no longer in review';

export class ReviewAdminController extends BaseController {
    static logger = createLogger('ReviewAdminController');

    static async listPending(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        _context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<PendingReviewsData>>> {
        try {
            const rows = await new TemplateService(env).listPending();
            return ReviewAdminController.createSuccessResponse<PendingReviewsData>({
                reviews: rows.map(toPendingReview),
            });
        } catch (error) {
            this.logger.error('Error listing pending templates', error);
            return ReviewAdminController.createErrorResponse<PendingReviewsData>('Failed to load the review queue', 500);
        }
    }

    /** The latest Stripe sales and Estori's total fees. */
    static async listSales(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        _context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<AdminSalesData>>> {
        try {
            const listings = new TemplateService(env);
            const [rows, totalFeesCents] = await Promise.all([listings.listRecentSales(50), listings.sumPlatformFees()]);
            return ReviewAdminController.createSuccessResponse<AdminSalesData>({
                sales: rows.map((row) => ({
                    purchaseId: row.purchaseId,
                    appId: row.appId,
                    appTitle: row.appTitle,
                    buyerEmail: row.buyerEmail,
                    priceCents: row.priceCents,
                    platformFeeCents: row.platformFeeCents ?? 0,
                    soldAt: row.createdAt ? row.createdAt.toISOString() : null,
                })),
                totalFeesCents,
            });
        } catch (error) {
            this.logger.error('Error listing sales', error);
            return ReviewAdminController.createErrorResponse<AdminSalesData>('Failed to load sales', 500);
        }
    }

    static async listVersionFiles(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<ReviewVersionFilesData>>> {
        try {
            const files = await ReviewAdminController.loadSnapshot(env, context.pathParams.id);
            if (!files) {
                return ReviewAdminController.createErrorResponse<ReviewVersionFilesData>('Version not found', 404);
            }
            return ReviewAdminController.createSuccessResponse<ReviewVersionFilesData>({
                files: files.map((file) => ({ path: file.path, bytes: file.bytes.byteLength })),
            });
        } catch (error) {
            this.logger.error('Error listing template files', error);
            return ReviewAdminController.createErrorResponse<ReviewVersionFilesData>('Failed to read the snapshot', 500);
        }
    }

    static async readVersionFile(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<ReviewVersionFileData>>> {
        try {
            const path = new URL(request.url).searchParams.get('path');
            if (!path) {
                return ReviewAdminController.createErrorResponse<ReviewVersionFileData>('path is required', 400);
            }
            const files = await ReviewAdminController.loadSnapshot(env, context.pathParams.id);
            const file = files?.find((candidate) => candidate.path === path);
            if (!file) {
                return ReviewAdminController.createErrorResponse<ReviewVersionFileData>('File not found', 404);
            }
            const content = decodeText(file.bytes);
            return ReviewAdminController.createSuccessResponse<ReviewVersionFileData>({
                path: file.path,
                bytes: file.bytes.byteLength,
                binary: content === null,
                content,
            });
        } catch (error) {
            this.logger.error('Error reading template file', error);
            return ReviewAdminController.createErrorResponse<ReviewVersionFileData>('Failed to read the file', 500);
        }
    }

    static async serveVersionScreenshot(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<never>>> {
        try {
            const { id: versionId, kind } = context.pathParams;
            if (!versionId || !kind || !isTemplateShotKind(kind)) {
                return ReviewAdminController.createErrorResponse('Screenshot not found', 404);
            }
            const version = await new TemplateService(env).getVersion(versionId);
            if (!version) {
                return ReviewAdminController.createErrorResponse('Screenshot not found', 404);
            }
            const key = kind === 'desktop' ? version.desktopShotKey : version.mobileShotKey;
            const image = await templateImageResponse(env.TEMPLATES_BUCKET, key, REVIEW_SCREENSHOT_CACHE);
            if (!image) {
                return ReviewAdminController.createErrorResponse('Screenshot not found', 404);
            }
            // Binary route: the router passes this Response through unchanged.
            return image as unknown as ControllerResponse<ApiResponse<never>>;
        } catch (error) {
            this.logger.error('Error serving review screenshot', error);
            return ReviewAdminController.createErrorResponse('Internal server error', 500);
        }
    }

    /** Publish a pending version; it supersedes the listing's current version. */
    static async approveVersion(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<PaidVersionActionData>>> {
        try {
            const versionId = context.pathParams.id;
            const listings = new TemplateService(env);
            const row = await listings.getVersionWithListing(versionId);
            if (!row) {
                return ReviewAdminController.createErrorResponse<PaidVersionActionData>('Version not found', 404);
            }
            if (!canReview(row.version.status)) {
                return ReviewAdminController.createErrorResponse<PaidVersionActionData>('Only versions in review can be approved', 400);
            }
            const approved = await listings.approveVersion({
                listingId: row.listing.id,
                versionId,
                supersedeVersionId: supersededVersionId(row.listing.currentVersionId, versionId),
                reviewerId: context.user!.id,
            });
            if (!approved) {
                return ReviewAdminController.createErrorResponse<PaidVersionActionData>(NO_LONGER_IN_REVIEW_MESSAGE, 409);
            }
            return ReviewAdminController.createSuccessResponse<PaidVersionActionData>({ versionId, status: 'approved' });
        } catch (error) {
            this.logger.error('Error approving template version', error);
            return ReviewAdminController.createErrorResponse<PaidVersionActionData>('Failed to approve the version', 500);
        }
    }

    static async rejectVersion(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<PaidVersionActionData>>> {
        try {
            const versionId = context.pathParams.id;
            const bodyResult = await ReviewAdminController.parseJsonBody<RejectVersionRequest>(request);
            if (!bodyResult.success) {
                return bodyResult.response! as ControllerResponse<ApiResponse<PaidVersionActionData>>;
            }
            const reason = parseRejectionReason(bodyResult.data);
            if (!reason.ok) {
                return ReviewAdminController.createErrorResponse<PaidVersionActionData>(reason.error, 400);
            }
            const templates = new TemplateService(env);
            const version = await templates.getVersion(versionId);
            if (!version) {
                return ReviewAdminController.createErrorResponse<PaidVersionActionData>('Version not found', 404);
            }
            if (!canReview(version.status)) {
                return ReviewAdminController.createErrorResponse<PaidVersionActionData>('Only versions in review can be rejected', 400);
            }
            const rejected = await templates.rejectVersion(versionId, context.user!.id, reason.value);
            if (!rejected) {
                return ReviewAdminController.createErrorResponse<PaidVersionActionData>(NO_LONGER_IN_REVIEW_MESSAGE, 409);
            }
            return ReviewAdminController.createSuccessResponse<PaidVersionActionData>({ versionId, status: 'rejected' });
        } catch (error) {
            this.logger.error('Error rejecting template version', error);
            return ReviewAdminController.createErrorResponse<PaidVersionActionData>('Failed to reject the version', 500);
        }
    }

    /** Hide a public site from Discover and block its reuse, or restore it. */
    static async setDiscoverRemoval(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<DiscoverRemovalData>>> {
        try {
            const appId = context.pathParams.id;
            const bodyResult = await ReviewAdminController.parseJsonBody<DiscoverRemovalRequest>(request);
            if (!bodyResult.success) {
                return bodyResult.response! as ControllerResponse<ApiResponse<DiscoverRemovalData>>;
            }
            const removal = parseDiscoverRemoval(bodyResult.data);
            if (!removal.ok) {
                return ReviewAdminController.createErrorResponse<DiscoverRemovalData>(removal.error, 400);
            }
            const changed = await new AppService(env).setRemovedFromDiscover(
                appId,
                removal.value.removed ? { by: context.user!.id, reason: removal.value.reason } : null,
            );
            if (!changed) {
                return ReviewAdminController.createErrorResponse<DiscoverRemovalData>('App not found', 404);
            }
            return ReviewAdminController.createSuccessResponse<DiscoverRemovalData>({ appId, removed: removal.value.removed });
        } catch (error) {
            this.logger.error('Error changing Discover removal', error);
            return ReviewAdminController.createErrorResponse<DiscoverRemovalData>('Failed to change the removal', 500);
        }
    }

    /** Capture showcase images for Discover stores that lack one, one batch per call. */
    static async refreshShowcaseScreenshots(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        _context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<ShowcaseRefreshData>>> {
        try {
            const { ids, remaining } = await new AppService(env).listAppsMissingShowcase(SHOWCASE_REFRESH_BATCH);
            const { captured, failed } = await runShowcaseRefresh(ids, (appId) => refreshShowcaseScreenshot(env, ReviewAdminController.logger, appId));
            return ReviewAdminController.createSuccessResponse<ShowcaseRefreshData>({
                attempted: ids.length,
                captured,
                failed,
                remaining: remaining + failed,
            });
        } catch (error) {
            this.logger.error('Error refreshing showcase screenshots', error);
            return ReviewAdminController.createErrorResponse<ShowcaseRefreshData>('Failed to refresh the showcase images', 500);
        }
    }

    private static async loadSnapshot(env: Env, versionId: string): Promise<TreeFile[] | null> {
        const version: TemplateVersion | null = await new TemplateService(env).getVersion(versionId);
        if (!version) return null;
        return readTemplateSnapshot(env.TEMPLATES_BUCKET, version.snapshotKey);
    }
}
