/**
 * Template endpoints for creators (submit, withdraw, unlist), buyers and the
 * public gallery. Review endpoints live in adminController.ts.
 */

import { BaseController } from '../baseController';
import type { ApiResponse, ControllerResponse } from '../types';
import type { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';
import { TemplateService, UserService } from '../../../database';
import type { NewTemplate } from '../../../database/schema';
import { RateLimitService } from '../../../services/rate-limit/rateLimits';
import { RateLimitExceededError } from 'shared/types/errors';
import { getAgentStub, getSpaceTemplateStub } from '../../../agents';
import type { TemplateSource } from '../../../agents/core/types';
import { generateId } from '../../../utils/idGenerator';
import {
    NOT_DEPLOYED_REASON,
    TEMPLATE_UNAVAILABLE_MESSAGE,
    VERSION_IN_REVIEW_ERROR,
    canSubmitNewVersion,
    canUseTemplate,
    canWithdraw,
    eligibilityReason,
    isTemplateShotKind,
    isTemplateSlug,
    listingDecision,
    parseListingRequest,
    parseRightsConfirmation,
    parseTemplateMetadata,
    purchaseDecision,
    uniqueTemplateSlug,
    type TemplateMetadata,
} from '../../../services/templates/catalog';
import { READ_FAILED_MESSAGE, TemplateSubmissionError, submitTemplateVersion } from '../../../services/templates/submit';
import { r2TemplateStore, templateImageResponse } from '../../../services/templates/store';
import { createTemplateShotCapturer } from '../../../services/templates/capture';
import { parseGalleryQuery } from './galleryQuery';
import { toCreatorTemplate, toPublicTemplateCard, toPublicTemplateDetail } from './templateDto';
import type {
    AppTemplateData,
    MyTemplatesData,
    SubmitTemplateData,
    SubmitTemplateRequest,
    TemplateDetailData,
    TemplateGalleryData,
    TemplateListingData,
    TemplateListingRequest,
    TemplatePurchaseData,
    TemplateVersionActionData,
} from './types';

const PUBLIC_SCREENSHOT_CACHE = 'public, max-age=3600';

export class TemplatesController extends BaseController {
    static logger = createLogger('TemplatesController');

    /** Submission status and eligibility for one of the owner's apps. */
    static async getAppTemplate(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<AppTemplateData>>> {
        try {
            const appId = context.pathParams.id;
            const templates = new TemplateService(env);
            const [source, template] = await Promise.all([
                TemplatesController.loadTemplateSource(env, appId),
                templates.getTemplateBySourceApp(appId),
            ]);
            const view = template ? toCreatorTemplate(template, await templates.listVersions(template.id)) : null;
            return TemplatesController.createSuccessResponse<AppTemplateData>({
                eligible: source.source !== null,
                reason: source.reason,
                template: view,
            });
        } catch (error) {
            this.logger.error('Error loading app template', error);
            return TemplatesController.createErrorResponse<AppTemplateData>('Failed to load template status', 500);
        }
    }

    /** Freeze the app's deployed commit as a new pending version. */
    static async submitTemplate(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<SubmitTemplateData>>> {
        try {
            const user = context.user!;
            const appId = context.pathParams.id;
            const bodyResult = await TemplatesController.parseJsonBody<SubmitTemplateRequest>(request);
            if (!bodyResult.success) {
                return bodyResult.response! as ControllerResponse<ApiResponse<SubmitTemplateData>>;
            }
            const rights = parseRightsConfirmation(bodyResult.data);
            if (!rights.ok) {
                return TemplatesController.createErrorResponse<SubmitTemplateData>(rights.error, 400);
            }

            const templates = new TemplateService(env);
            const existing = await templates.getTemplateBySourceApp(appId);
            let metadata: TemplateMetadata | null = null;
            if (existing) {
                const versions = await templates.listVersions(existing.id);
                if (!canSubmitNewVersion(versions.map((version) => version.status))) {
                    return TemplatesController.createErrorResponse<SubmitTemplateData>(VERSION_IN_REVIEW_ERROR, 409);
                }
            } else {
                const parsed = parseTemplateMetadata(bodyResult.data);
                if (!parsed.ok) {
                    return TemplatesController.createErrorResponse<SubmitTemplateData>(parsed.error, 400);
                }
                metadata = parsed.value;
            }

            const { source, reason } = await TemplatesController.loadTemplateSource(env, appId);
            if (!source) {
                return TemplatesController.createErrorResponse<SubmitTemplateData>(reason ?? NOT_DEPLOYED_REASON, 400);
            }

            try {
                await RateLimitService.enforceTemplateSubmissionRateLimit(env, context.config.security.rateLimit, user);
            } catch (error) {
                if (error instanceof RateLimitExceededError) {
                    return TemplatesController.createErrorResponse<SubmitTemplateData>(error, 429);
                }
                throw error;
            }

            const space = getSpaceTemplateStub(env, appId);
            if (!space) {
                return TemplatesController.createErrorResponse<SubmitTemplateData>(READ_FAILED_MESSAGE, 500);
            }

            const ids = { templateId: existing?.id ?? generateId(), versionId: generateId() };
            const version = existing ? await templates.nextVersionNumber(existing.id) : 1;
            const now = new Date();
            const newTemplate: NewTemplate | null = metadata
                ? {
                      id: ids.templateId,
                      slug: await uniqueTemplateSlug(metadata.name, (candidate) => templates.isSlugTaken(candidate)),
                      creatorUserId: user.id,
                      sourceAppId: appId,
                      name: metadata.name,
                      description: metadata.description,
                      category: metadata.category,
                      priceCents: metadata.priceCents,
                      createdAt: now,
                      updatedAt: now,
                  }
                : null;

            const record = await submitTemplateVersion(
                {
                    readTree: (commit) => space.readTreeAtCommit(commit),
                    captureShot: createTemplateShotCapturer(env, TemplatesController.logger),
                    store: r2TemplateStore(env.TEMPLATES_BUCKET),
                    recordVersion: (submission) =>
                        templates.insertSubmission({
                            template: newTemplate,
                            version: {
                                id: submission.versionId,
                                templateId: submission.templateId,
                                version,
                                sourceCommit: submission.sourceCommit,
                                snapshotKey: submission.snapshotKey,
                                fileCount: submission.fileCount,
                                totalBytes: submission.totalBytes,
                                desktopShotKey: submission.desktopShotKey,
                                mobileShotKey: submission.mobileShotKey,
                                status: 'pending',
                                rightsConfirmedAt: now,
                                createdAt: now,
                            },
                        }),
                },
                source,
                ids,
            );

            return TemplatesController.createSuccessResponse<SubmitTemplateData>({
                templateId: record.templateId,
                versionId: record.versionId,
                version,
            });
        } catch (error) {
            if (error instanceof TemplateSubmissionError) {
                return TemplatesController.createErrorResponse<SubmitTemplateData>(error.message, error.status);
            }
            this.logger.error('Error submitting template', error);
            return TemplatesController.createErrorResponse<SubmitTemplateData>('Failed to submit template', 500);
        }
    }

    static async withdrawVersion(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<TemplateVersionActionData>>> {
        try {
            const user = context.user!;
            const { id: templateId, versionId } = context.pathParams;
            const templates = new TemplateService(env);
            const [template, version] = await Promise.all([
                templates.getTemplate(templateId),
                templates.getVersion(versionId),
            ]);
            if (!template || !version || version.templateId !== template.id) {
                return TemplatesController.createErrorResponse<TemplateVersionActionData>('Template version not found', 404);
            }
            if (template.creatorUserId !== user.id) {
                return TemplatesController.createErrorResponse<TemplateVersionActionData>('You can only change your own templates', 403);
            }
            if (!canWithdraw(version.status)) {
                return TemplatesController.createErrorResponse<TemplateVersionActionData>('Only versions in review can be withdrawn', 400);
            }
            const withdrawn = await templates.withdrawVersion(versionId);
            if (!withdrawn) {
                return TemplatesController.createErrorResponse<TemplateVersionActionData>('This version is no longer in review', 409);
            }
            return TemplatesController.createSuccessResponse<TemplateVersionActionData>({ versionId, status: 'withdrawn' });
        } catch (error) {
            this.logger.error('Error withdrawing template version', error);
            return TemplatesController.createErrorResponse<TemplateVersionActionData>('Failed to withdraw the version', 500);
        }
    }

    static async setListing(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<TemplateListingData>>> {
        try {
            const user = context.user!;
            const templateId = context.pathParams.id;
            const bodyResult = await TemplatesController.parseJsonBody<TemplateListingRequest>(request);
            if (!bodyResult.success) {
                return bodyResult.response! as ControllerResponse<ApiResponse<TemplateListingData>>;
            }
            const listed = parseListingRequest(bodyResult.data);
            if (!listed.ok) {
                return TemplatesController.createErrorResponse<TemplateListingData>(listed.error, 400);
            }

            const templates = new TemplateService(env);
            const template = await templates.getTemplate(templateId);
            if (!template) {
                return TemplatesController.createErrorResponse<TemplateListingData>('Template not found', 404);
            }
            const isAdmin = (await new UserService(env).getRole(user.id)) === 'admin';
            const decision = listingDecision({
                isAdmin,
                isCreator: template.creatorUserId === user.id,
                listed: listed.value,
                hasApprovedVersion: template.currentVersionId !== null,
            });
            if (!decision.ok) {
                return TemplatesController.createErrorResponse<TemplateListingData>(decision.error, decision.status);
            }
            await templates.setListing(templateId, listed.value);
            return TemplatesController.createSuccessResponse<TemplateListingData>({
                templateId,
                status: listed.value ? 'listed' : 'unlisted',
            });
        } catch (error) {
            this.logger.error('Error changing template listing', error);
            return TemplatesController.createErrorResponse<TemplateListingData>('Failed to change the listing', 500);
        }
    }

    static async getMyTemplates(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<MyTemplatesData>>> {
        try {
            const rows = await new TemplateService(env).listByCreator(context.user!.id);
            return TemplatesController.createSuccessResponse<MyTemplatesData>({
                templates: rows.map((row) => toCreatorTemplate(row.template, row.versions)),
            });
        } catch (error) {
            this.logger.error('Error loading creator templates', error);
            return TemplatesController.createErrorResponse<MyTemplatesData>('Failed to load your templates', 500);
        }
    }

    static async listTemplates(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<TemplateGalleryData>>> {
        try {
            if (await TemplatesController.isPublicRateLimited(request, env, context)) {
                return TemplatesController.createErrorResponse<TemplateGalleryData>('Too many requests', 429);
            }
            const parsed = parseGalleryQuery(new URL(request.url).searchParams);
            if (!parsed.ok) {
                return TemplatesController.createErrorResponse<TemplateGalleryData>(parsed.error, 400);
            }
            const { rows, total } = await new TemplateService(env).listPublished(parsed.value);
            return TemplatesController.createSuccessResponse<TemplateGalleryData>({
                templates: rows.map(toPublicTemplateCard),
                total,
                page: parsed.value.page,
                hasMore: parsed.value.offset + rows.length < total,
            });
        } catch (error) {
            this.logger.error('Error listing templates', error);
            return TemplatesController.createErrorResponse<TemplateGalleryData>('Failed to load templates', 500);
        }
    }

    static async getTemplate(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<TemplateDetailData>>> {
        try {
            if (await TemplatesController.isPublicRateLimited(request, env, context)) {
                return TemplatesController.createErrorResponse<TemplateDetailData>('Too many requests', 429);
            }
            const slug = context.pathParams.slug;
            if (!slug || !isTemplateSlug(slug)) {
                return TemplatesController.createErrorResponse<TemplateDetailData>(TEMPLATE_UNAVAILABLE_MESSAGE, 404);
            }
            const templates = new TemplateService(env);
            const row = await templates.getPublishedBySlug(slug);
            if (!row) {
                return TemplatesController.createErrorResponse<TemplateDetailData>(TEMPLATE_UNAVAILABLE_MESSAGE, 404);
            }
            const user = await TemplatesController.getOptionalUser(request, env);
            const isCreator = !!user && user.id === row.template.creatorUserId;
            const purchased =
                !!user && !isCreator && row.template.priceCents > 0
                    ? await templates.hasPurchase(row.template.id, user.id)
                    : false;
            return TemplatesController.createSuccessResponse<TemplateDetailData>({
                template: toPublicTemplateDetail(row),
                viewer: {
                    isCreator,
                    purchased,
                    canUse: canUseTemplate({ priceCents: row.template.priceCents, isCreator, hasPurchase: purchased }),
                },
            });
        } catch (error) {
            this.logger.error('Error loading template', error);
            return TemplatesController.createErrorResponse<TemplateDetailData>('Failed to load the template', 500);
        }
    }

    /** Screenshot of a listed template's current version. */
    static async serveScreenshot(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<never>>> {
        try {
            const { id: templateId, kind } = context.pathParams;
            if (!templateId || !kind || !isTemplateShotKind(kind)) {
                return TemplatesController.createErrorResponse('Screenshot not found', 404);
            }
            const row = await new TemplateService(env).getPublishedById(templateId);
            if (!row) {
                return TemplatesController.createErrorResponse('Screenshot not found', 404);
            }
            const key = kind === 'desktop' ? row.version.desktopShotKey : row.version.mobileShotKey;
            const image = await templateImageResponse(env.TEMPLATES_BUCKET, key, PUBLIC_SCREENSHOT_CACHE);
            if (!image) {
                return TemplatesController.createErrorResponse('Screenshot not found', 404);
            }
            // Binary route: the router passes this Response through unchanged.
            return image as unknown as ControllerResponse<ApiResponse<never>>;
        } catch (error) {
            this.logger.error('Error serving template screenshot', error);
            return TemplatesController.createErrorResponse('Internal server error', 500);
        }
    }

    /** Record a test-mode purchase (no charge) of a paid template. */
    static async purchaseTemplate(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<TemplatePurchaseData>>> {
        try {
            const user = context.user!;
            const templateId = context.pathParams.id;
            const templates = new TemplateService(env);
            const row = await templates.getPublishedById(templateId);
            if (!row) {
                return TemplatesController.createErrorResponse<TemplatePurchaseData>(TEMPLATE_UNAVAILABLE_MESSAGE, 404);
            }
            const isCreator = row.template.creatorUserId === user.id;
            const hasPurchase = await templates.hasPurchase(templateId, user.id);
            const decision = purchaseDecision({ priceCents: row.template.priceCents, isCreator, hasPurchase });
            if (!decision.ok) {
                return TemplatesController.createErrorResponse<TemplatePurchaseData>(decision.error, decision.status);
            }
            if (!decision.alreadyOwned) {
                await templates.recordPurchase({ templateId, userId: user.id, priceCents: row.template.priceCents });
            }
            return TemplatesController.createSuccessResponse<TemplatePurchaseData>({
                templateId,
                purchased: true,
                testMode: true,
            });
        } catch (error) {
            this.logger.error('Error purchasing template', error);
            return TemplatesController.createErrorResponse<TemplatePurchaseData>('Failed to buy the template', 500);
        }
    }

    /** The deployed commit and preview URL of an app, or why it cannot be submitted. */
    private static async loadTemplateSource(
        env: Env,
        appId: string,
    ): Promise<{ source: TemplateSource | null; reason: string | null }> {
        const agent = await getAgentStub(env, appId);
        const behaviorType = await agent.getBehaviorType();
        const source = behaviorType === 'think' ? await agent.getTemplateSource() : null;
        return { source, reason: eligibilityReason(behaviorType, source !== null) };
    }

    private static async isPublicRateLimited(request: Request, env: Env, context: RouteContext): Promise<boolean> {
        const user = await TemplatesController.getOptionalUser(request, env);
        try {
            await RateLimitService.enforcePublicAppsRateLimit(env, context.config.security.rateLimit, user, request);
            return false;
        } catch (error) {
            if (error instanceof RateLimitExceededError) return true;
            throw error;
        }
    }
}
