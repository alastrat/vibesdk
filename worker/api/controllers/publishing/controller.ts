/**
 * Publishing endpoints: make an app public or private, manage its paid
 * listing, and buy a paid site. Review endpoints live in adminController.ts.
 */

import { BaseController } from '../baseController';
import type { ApiResponse, ControllerResponse } from '../types';
import type { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';
import { AppService, TemplateService } from '../../../database';
import { RateLimitService } from '../../../services/rate-limit/rateLimits';
import { RateLimitExceededError } from 'shared/types/errors';
import { getAgentStub, getAgentStubLightweight, getSpaceTemplateStub, type SpaceTemplateStub } from '../../../agents';
import type { TemplateSource } from '../../../agents/core/types';
import { generateId } from '../../../utils/idGenerator';
import { VERSION_IN_REVIEW_ERROR, canSubmitNewVersion, canWithdraw, purchaseDecision } from '../../../services/templates/catalog';
import {
    NOT_DEPLOYED_REASON,
    SITE_UNAVAILABLE_MESSAGE,
    parsePublishRequest,
    publishEligibilityReason,
    type PublishRequest,
} from '../../../services/templates/reuse';
import { publishSite, type PublishDeps } from '../../../services/templates/publish';
import { READ_FAILED_MESSAGE, TemplateSubmissionError, submitTemplateVersion } from '../../../services/templates/submit';
import { r2TemplateStore } from '../../../services/templates/store';
import { createTemplateShotCapturer } from '../../../services/templates/capture';
import { toOwnerPaidListing } from './publishingDto';
import type {
    MyPaidListingsData,
    PaidVersionActionData,
    PublishSiteData,
    PublishSiteRequest,
    SitePublishingData,
    SitePurchaseData,
} from './types';

function publishMessage(request: PublishRequest, inReview: boolean): string {
    if (request.visibility === 'private') return 'Your site is private';
    if (inReview) return 'Your site is public. Others can use it once an admin approves the price.';
    return request.priceCents > 0 ? 'Your publishing settings are saved' : 'Your site is public and others can reuse it';
}

export class PublishingController extends BaseController {
    static logger = createLogger('PublishingController');

    /** Make an app public (with consent, category and price) or private. */
    static async updateVisibility(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<PublishSiteData>>> {
        try {
            const bodyResult = await PublishingController.parseJsonBody<PublishSiteRequest>(request);
            if (!bodyResult.success) {
                return bodyResult.response! as ControllerResponse<ApiResponse<PublishSiteData>>;
            }
            const parsed = parsePublishRequest(bodyResult.data);
            if (!parsed.ok) {
                return PublishingController.createErrorResponse<PublishSiteData>(parsed.error, 400);
            }
            const outcome = await publishSite(
                PublishingController.publishDeps(env, context, context.pathParams.id),
                parsed.value,
            );
            if (!outcome.ok) {
                return PublishingController.createErrorResponse<PublishSiteData>(outcome.error, outcome.status);
            }
            return PublishingController.createSuccessResponse<PublishSiteData>({
                visibility: parsed.value.visibility,
                inReview: outcome.inReview,
                message: publishMessage(parsed.value, outcome.inReview),
            });
        } catch (error) {
            if (error instanceof RateLimitExceededError) {
                return PublishingController.createErrorResponse<PublishSiteData>(error, 429);
            }
            this.logger.error('Error publishing site', error);
            return PublishingController.createErrorResponse<PublishSiteData>('Failed to update app visibility', 500);
        }
    }

    /** Publishing choices, eligibility, paid listing and removal for one of the owner's apps. */
    static async getPublishing(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<SitePublishingData>>> {
        try {
            const appId = context.pathParams.id;
            const listings = new TemplateService(env);
            const [state, listing, facts] = await Promise.all([
                new AppService(env).getPublishingState(appId),
                listings.getListingByApp(appId),
                PublishingController.loadFacts(env, appId),
            ]);
            if (!state) {
                return PublishingController.createErrorResponse<SitePublishingData>('App not found', 404);
            }
            const [versions, buyerCount] = listing
                ? await Promise.all([listings.listVersions(listing.id), listings.countBuyers(listing.id)])
                : [[], 0];
            return PublishingController.createSuccessResponse<SitePublishingData>({
                visibility: state.visibility,
                category: state.category,
                ineligibleReason: publishEligibilityReason(facts.behaviorType, facts.deployedCommit !== null),
                listing: listing ? toOwnerPaidListing(listing, versions, buyerCount) : null,
                removedFromDiscover: state.removedFromDiscoverAt ? { reason: state.removedFromDiscoverReason } : null,
            });
        } catch (error) {
            this.logger.error('Error loading publishing state', error);
            return PublishingController.createErrorResponse<SitePublishingData>('Failed to load publishing settings', 500);
        }
    }

    /** Store the latest deploy of a paid site as a new version for review. */
    static async submitPaidUpdate(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<PaidVersionActionData>>> {
        try {
            const appId = context.pathParams.id;
            const listings = new TemplateService(env);
            const listing = await listings.getListingByApp(appId);
            if (!listing || listing.status !== 'listed') {
                return PublishingController.createErrorResponse<PaidVersionActionData>('Set a price for this site first', 400);
            }
            const versions = await listings.listVersions(listing.id);
            if (!canSubmitNewVersion(versions.map((version) => version.status))) {
                return PublishingController.createErrorResponse<PaidVersionActionData>(VERSION_IN_REVIEW_ERROR, 409);
            }
            const source = await (await getAgentStub(env, appId)).getTemplateSource();
            if (!source) {
                return PublishingController.createErrorResponse<PaidVersionActionData>(NOT_DEPLOYED_REASON, 400);
            }
            const priceCents = versions[0]?.priceCents ?? listing.priceCents;
            const versionId = await PublishingController.submitVersion(
                env,
                context,
                listing.id,
                source,
                priceCents,
                getSpaceTemplateStub(env, appId),
            );
            return PublishingController.createSuccessResponse<PaidVersionActionData>({ versionId, status: 'pending' });
        } catch (error) {
            if (error instanceof RateLimitExceededError) {
                return PublishingController.createErrorResponse<PaidVersionActionData>(error, 429);
            }
            if (error instanceof TemplateSubmissionError) {
                this.logger.warn('Paid update failed', { status: error.status, message: error.message, cause: error.cause });
                return PublishingController.createErrorResponse<PaidVersionActionData>(error.message, error.status);
            }
            this.logger.error('Error submitting paid update', error);
            return PublishingController.createErrorResponse<PaidVersionActionData>('Failed to send the update for review', 500);
        }
    }

    static async withdrawPaidVersion(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<PaidVersionActionData>>> {
        try {
            const { id: appId, versionId } = context.pathParams;
            const listings = new TemplateService(env);
            const [listing, version] = await Promise.all([listings.getListingByApp(appId), listings.getVersion(versionId)]);
            if (!listing || !version || version.templateId !== listing.id) {
                return PublishingController.createErrorResponse<PaidVersionActionData>('Version not found', 404);
            }
            if (!canWithdraw(version.status)) {
                return PublishingController.createErrorResponse<PaidVersionActionData>('Only versions in review can be withdrawn', 400);
            }
            if (!(await listings.withdrawVersion(versionId))) {
                return PublishingController.createErrorResponse<PaidVersionActionData>('This version is no longer in review', 409);
            }
            return PublishingController.createSuccessResponse<PaidVersionActionData>({ versionId, status: 'withdrawn' });
        } catch (error) {
            this.logger.error('Error withdrawing paid version', error);
            return PublishingController.createErrorResponse<PaidVersionActionData>('Failed to withdraw the version', 500);
        }
    }

    /** Record a test-mode purchase (no charge) of an approved paid site. */
    static async purchase(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<SitePurchaseData>>> {
        try {
            const user = context.user!;
            const appId = context.pathParams.id;
            const app = await new AppService(env).getReuseSource(appId);
            if (!app || app.visibility !== 'public' || app.removedFromDiscoverAt) {
                return PublishingController.createErrorResponse<SitePurchaseData>(SITE_UNAVAILABLE_MESSAGE, 404);
            }
            const listings = new TemplateService(env);
            const listing = await listings.getListingByApp(appId);
            const paid = listing !== null && listing.status === 'listed' && listing.currentVersionId !== null;
            const hasPurchase = paid ? await listings.hasPurchase(listing.id, user.id) : false;
            const decision = purchaseDecision({
                priceCents: paid ? listing.priceCents : 0,
                isCreator: app.userId === user.id,
                hasPurchase,
            });
            if (!decision.ok) {
                return PublishingController.createErrorResponse<SitePurchaseData>(decision.error, decision.status);
            }
            if (paid && !decision.alreadyOwned) {
                await listings.recordPurchase({ listingId: listing.id, userId: user.id, priceCents: listing.priceCents });
            }
            return PublishingController.createSuccessResponse<SitePurchaseData>({ appId, purchased: true, testMode: true });
        } catch (error) {
            this.logger.error('Error buying site', error);
            return PublishingController.createErrorResponse<SitePurchaseData>('Failed to buy the site', 500);
        }
    }

    static async getMyPaidListings(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<MyPaidListingsData>>> {
        try {
            const rows = await new TemplateService(env).listByCreator(context.user!.id);
            return PublishingController.createSuccessResponse<MyPaidListingsData>({
                listings: rows.map((row) => ({
                    ...toOwnerPaidListing(row.listing, row.versions, row.buyerCount),
                    appId: row.listing.sourceAppId,
                    appTitle: row.appTitle,
                })),
            });
        } catch (error) {
            this.logger.error('Error loading paid listings', error);
            return PublishingController.createErrorResponse<MyPaidListingsData>('Failed to load your paid listings', 500);
        }
    }

    private static async loadFacts(env: Env, appId: string): Promise<{ behaviorType: string; deployedCommit: string | null }> {
        try {
            const agent = await getAgentStubLightweight(env, appId);
            const [behaviorType, deployedCommit] = await Promise.all([agent.getBehaviorType(), agent.getDeployedCommit()]);
            return { behaviorType, deployedCommit };
        } catch {
            return { behaviorType: 'unknown', deployedCommit: null };
        }
    }

    private static publishDeps(env: Env, context: RouteContext, appId: string): PublishDeps {
        const userId = context.user!.id;
        const apps = new AppService(env);
        const listings = new TemplateService(env);
        const space = getSpaceTemplateStub(env, appId);
        return {
            async loadListing() {
                const listing = await listings.getListingByApp(appId);
                if (!listing) return null;
                const pending = await listings.getPendingVersion(listing.id);
                return {
                    id: listing.id,
                    state: {
                        status: listing.status,
                        currentVersionId: listing.currentVersionId,
                        priceCents: listing.priceCents,
                        pendingPriceCents: pending?.priceCents ?? null,
                    },
                };
            },
            async loadSource() {
                const agent = await getAgentStub(env, appId);
                const behaviorType = await agent.getBehaviorType();
                return { behaviorType, source: behaviorType === 'think' ? await agent.getTemplateSource() : null };
            },
            async readTree(commit) {
                if (!space) throw new Error('The app workspace is unavailable');
                return space.readTreeAtCommit(commit);
            },
            createListing: () => listings.createListing({ sourceAppId: appId, creatorUserId: userId }),
            setListingStatus: (listingId, status) => listings.setListingStatus(listingId, status),
            async submitVersion(listingId, source, priceCents) {
                await PublishingController.submitVersion(env, context, listingId, source, priceCents, space);
            },
            async applyVisibility(request) {
                const result = await apps.updateAppVisibility(
                    appId,
                    userId,
                    request.visibility,
                    request.visibility === 'public' ? { category: request.category, reuseConsentAt: new Date() } : undefined,
                );
                if (!result.success) throw new Error(result.error ?? 'Failed to update app visibility');
                if (request.visibility === 'public') await apps.updateApp(appId, { lastDeployedAt: new Date() });
            },
        };
    }

    /** Store the deployed commit as a pending version; rate limited like submissions. Returns the version id. */
    private static async submitVersion(
        env: Env,
        context: RouteContext,
        listingId: string,
        source: TemplateSource,
        priceCents: number,
        space: SpaceTemplateStub | null,
    ): Promise<string> {
        if (!space) throw new TemplateSubmissionError(READ_FAILED_MESSAGE, 500);
        await RateLimitService.enforceTemplateSubmissionRateLimit(env, context.config.security.rateLimit, context.user!);
        const listings = new TemplateService(env);
        const version = await listings.nextVersionNumber(listingId);
        const now = new Date();
        const record = await submitTemplateVersion(
            {
                readTree: (commit) => space.readTreeAtCommit(commit),
                captureShot: createTemplateShotCapturer(env, PublishingController.logger),
                store: r2TemplateStore(env.TEMPLATES_BUCKET),
                onCleanupError: (error) => PublishingController.logger.warn('Paid version cleanup failed', error),
                recordVersion: (submission) =>
                    listings.insertVersion({
                        id: submission.versionId,
                        templateId: submission.templateId,
                        version,
                        priceCents,
                        sourceCommit: submission.sourceCommit,
                        snapshotKey: submission.snapshotKey,
                        fileCount: submission.fileCount,
                        totalBytes: submission.totalBytes,
                        desktopShotKey: submission.desktopShotKey,
                        mobileShotKey: submission.mobileShotKey,
                        status: 'pending',
                        rightsConfirmedAt: now,
                        createdAt: now,
                    }),
            },
            source,
            { templateId: listingId, versionId: generateId() },
        );
        return record.versionId;
    }
}
