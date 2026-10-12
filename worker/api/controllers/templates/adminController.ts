/**
 * Template review for admins: the pending queue, snapshot files, screenshots,
 * and approve or reject decisions.
 */

import { BaseController } from '../baseController';
import type { ApiResponse, ControllerResponse } from '../types';
import type { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';
import { TemplateService } from '../../../database';
import type { TemplateVersion } from '../../../database/schema';
import {
    canReview,
    isTemplateShotKind,
    parseRejectionReason,
    supersededVersionId,
} from '../../../services/templates/catalog';
import { decodeText, type TreeFile } from '../../../services/templates/snapshot';
import { readTemplateSnapshot, templateImageResponse } from '../../../services/templates/store';
import { toPendingTemplateVersion } from './templateDto';
import type {
    PendingTemplateVersionsData,
    RejectTemplateRequest,
    TemplateVersionActionData,
    TemplateVersionFileData,
    TemplateVersionFilesData,
} from './types';

const REVIEW_SCREENSHOT_CACHE = 'private, max-age=300';
const NO_LONGER_IN_REVIEW_MESSAGE = 'This version is no longer in review';

export class TemplateAdminController extends BaseController {
    static logger = createLogger('TemplateAdminController');

    static async listPending(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        _context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<PendingTemplateVersionsData>>> {
        try {
            const rows = await new TemplateService(env).listPending();
            return TemplateAdminController.createSuccessResponse<PendingTemplateVersionsData>({
                versions: rows.map(toPendingTemplateVersion),
            });
        } catch (error) {
            this.logger.error('Error listing pending templates', error);
            return TemplateAdminController.createErrorResponse<PendingTemplateVersionsData>('Failed to load the review queue', 500);
        }
    }

    static async listVersionFiles(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<TemplateVersionFilesData>>> {
        try {
            const files = await TemplateAdminController.loadSnapshot(env, context.pathParams.id);
            if (!files) {
                return TemplateAdminController.createErrorResponse<TemplateVersionFilesData>('Template version not found', 404);
            }
            return TemplateAdminController.createSuccessResponse<TemplateVersionFilesData>({
                files: files.map((file) => ({ path: file.path, bytes: file.bytes.byteLength })),
            });
        } catch (error) {
            this.logger.error('Error listing template files', error);
            return TemplateAdminController.createErrorResponse<TemplateVersionFilesData>('Failed to read the snapshot', 500);
        }
    }

    static async readVersionFile(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<TemplateVersionFileData>>> {
        try {
            const path = new URL(request.url).searchParams.get('path');
            if (!path) {
                return TemplateAdminController.createErrorResponse<TemplateVersionFileData>('path is required', 400);
            }
            const files = await TemplateAdminController.loadSnapshot(env, context.pathParams.id);
            const file = files?.find((candidate) => candidate.path === path);
            if (!file) {
                return TemplateAdminController.createErrorResponse<TemplateVersionFileData>('File not found', 404);
            }
            const content = decodeText(file.bytes);
            return TemplateAdminController.createSuccessResponse<TemplateVersionFileData>({
                path: file.path,
                bytes: file.bytes.byteLength,
                binary: content === null,
                content,
            });
        } catch (error) {
            this.logger.error('Error reading template file', error);
            return TemplateAdminController.createErrorResponse<TemplateVersionFileData>('Failed to read the file', 500);
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
                return TemplateAdminController.createErrorResponse('Screenshot not found', 404);
            }
            const version = await new TemplateService(env).getVersion(versionId);
            if (!version) {
                return TemplateAdminController.createErrorResponse('Screenshot not found', 404);
            }
            const key = kind === 'desktop' ? version.desktopShotKey : version.mobileShotKey;
            const image = await templateImageResponse(env.TEMPLATES_BUCKET, key, REVIEW_SCREENSHOT_CACHE);
            if (!image) {
                return TemplateAdminController.createErrorResponse('Screenshot not found', 404);
            }
            // Binary route: the router passes this Response through unchanged.
            return image as unknown as ControllerResponse<ApiResponse<never>>;
        } catch (error) {
            this.logger.error('Error serving review screenshot', error);
            return TemplateAdminController.createErrorResponse('Internal server error', 500);
        }
    }

    /** Publish a pending version; it supersedes the template's current version. */
    static async approveVersion(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<TemplateVersionActionData>>> {
        try {
            const versionId = context.pathParams.id;
            const templates = new TemplateService(env);
            const row = await templates.getVersionWithTemplate(versionId);
            if (!row) {
                return TemplateAdminController.createErrorResponse<TemplateVersionActionData>('Template version not found', 404);
            }
            if (!canReview(row.version.status)) {
                return TemplateAdminController.createErrorResponse<TemplateVersionActionData>('Only versions in review can be approved', 400);
            }
            const approved = await templates.approveVersion({
                templateId: row.template.id,
                versionId,
                supersedeVersionId: supersededVersionId(row.template.currentVersionId, versionId),
                reviewerId: context.user!.id,
            });
            if (!approved) {
                return TemplateAdminController.createErrorResponse<TemplateVersionActionData>(NO_LONGER_IN_REVIEW_MESSAGE, 409);
            }
            return TemplateAdminController.createSuccessResponse<TemplateVersionActionData>({ versionId, status: 'approved' });
        } catch (error) {
            this.logger.error('Error approving template version', error);
            return TemplateAdminController.createErrorResponse<TemplateVersionActionData>('Failed to approve the version', 500);
        }
    }

    static async rejectVersion(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<TemplateVersionActionData>>> {
        try {
            const versionId = context.pathParams.id;
            const bodyResult = await TemplateAdminController.parseJsonBody<RejectTemplateRequest>(request);
            if (!bodyResult.success) {
                return bodyResult.response! as ControllerResponse<ApiResponse<TemplateVersionActionData>>;
            }
            const reason = parseRejectionReason(bodyResult.data);
            if (!reason.ok) {
                return TemplateAdminController.createErrorResponse<TemplateVersionActionData>(reason.error, 400);
            }
            const templates = new TemplateService(env);
            const version = await templates.getVersion(versionId);
            if (!version) {
                return TemplateAdminController.createErrorResponse<TemplateVersionActionData>('Template version not found', 404);
            }
            if (!canReview(version.status)) {
                return TemplateAdminController.createErrorResponse<TemplateVersionActionData>('Only versions in review can be rejected', 400);
            }
            const rejected = await templates.rejectVersion(versionId, context.user!.id, reason.value);
            if (!rejected) {
                return TemplateAdminController.createErrorResponse<TemplateVersionActionData>(NO_LONGER_IN_REVIEW_MESSAGE, 409);
            }
            return TemplateAdminController.createSuccessResponse<TemplateVersionActionData>({ versionId, status: 'rejected' });
        } catch (error) {
            this.logger.error('Error rejecting template version', error);
            return TemplateAdminController.createErrorResponse<TemplateVersionActionData>('Failed to reject the version', 500);
        }
    }

    private static async loadSnapshot(env: Env, versionId: string): Promise<TreeFile[] | null> {
        const version: TemplateVersion | null = await new TemplateService(env).getVersion(versionId);
        if (!version) return null;
        return readTemplateSnapshot(env.TEMPLATES_BUCKET, version.snapshotKey);
    }
}
