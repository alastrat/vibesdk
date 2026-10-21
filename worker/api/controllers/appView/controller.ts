import { msg } from '../../../../shared/i18n/translate';

import { BaseController } from '../baseController';
import { ApiResponse, ControllerResponse } from '../types';
import type { RouteContext } from '../../types/route-context';
import { getAgentStubLightweight } from '../../../agents';
import { AppService } from '../../../database/services/AppService';
import { TemplateService, UserService } from '../../../database';
import type { EnhancedAppData } from '../../../database/types';
import type { Template } from '../../../database/schema';
import { 
    AppDetailsData, 
    AppStarToggleData,
    GitCloneTokenData,
    PreviewTokenData,
    AppReuseView,
    StartedFromView,
} from './types';
import { AgentSummary, BehaviorType } from '../../../agents/core/types';
import { toPublicAppDetail } from '../apps/publicAppDto';
import { createLogger } from '../../../logger';
import { canReadSource, reuseDecision } from '../../../services/templates/reuse';
import { toStartedFromView } from './started-from';
import { RateLimitService } from '../../../services/rate-limit/rateLimits';
import { RateLimitExceededError } from 'shared/types/errors';
import { recordVisit } from './record-visit';
import { buildUserWorkerUrl, buildGitCloneUrl } from 'worker/utils/urls';
import { JWTUtils } from '../../../utils/jwtUtils';
import {
    OWNER_PREVIEW_QUERY_PARAM,
    OWNER_PREVIEW_TOKEN_TTL_SECONDS,
    signOwnerPreviewToken,
} from '../../../utils/ownerPreviewToken';

interface ListingAccess {
    listing: Template | null;
    hasPurchase: boolean;
}

export class AppViewController extends BaseController {
    static logger = createLogger('AppViewController');
    
    // Get single app details (public endpoint, auth optional for ownership check)
    static async getAppDetails(request: Request, env: Env, ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<AppDetailsData>>> {
        try {
            const appId = context.pathParams.id;
            if (!appId) {
                return AppViewController.createErrorResponse<AppDetailsData>(msg('App ID is required'), 400);
            }
            
            // Try to get user if authenticated (optional for public endpoint)
            const user = await AppViewController.getOptionalUser(request, env);
            const userId = user?.id;

            try {
                await RateLimitService.enforcePublicAppsRateLimit(env, context.config.security.rateLimit, user ?? null, request);
            } catch (error) {
                if (error instanceof RateLimitExceededError) {
                    return AppViewController.createErrorResponse<AppDetailsData>(msg('Too many requests'), 429);
                }
                throw error;
            }

            // Get app details with stats using app service
            const appService = new AppService(env);
            const appResult = await appService.getAppDetails(appId, userId);

            if (!appResult) {
                return AppViewController.createErrorResponse<AppDetailsData>(msg('App not found'), 404);
            }

            // Check if user has permission to view
            if (appResult.visibility === 'private' && appResult.userId !== userId) {
                return AppViewController.createErrorResponse<AppDetailsData>(msg('App not found'), 404);
            }

            // Track view for all users (including owners and anonymous users).
            // Views are deduplicated per viewer per time bucket by AppService,
            // so anonymous viewers are identified by request metadata rather
            // than a unique-per-request token.
            await recordVisit(appService, appId, userId, request);

            // Try to fetch current agent state to get latest generated code
            let agentSummary: AgentSummary | null = null;
            let previewUrl: string = '';
            let behaviorType: BehaviorType | null = null;
            let deployedCommit: string | null = null;
            
            try {
                // Use lightweight stub for read-only operations (faster - skips template loading)
                const agentStub = await getAgentStubLightweight(env, appResult.id);
                const [summary, previewUrlCache, agentBehaviorType, agentDeployedCommit] = await Promise.all([
                    agentStub.getSummary(),
                    agentStub.getPreviewUrlCache(),
                    agentStub.getBehaviorType(),
                    agentStub.getDeployedCommit(),
                ]);
                agentSummary = summary;
                previewUrl = previewUrlCache;
                behaviorType = agentBehaviorType;
                deployedCommit = agentDeployedCommit;
            } catch (agentError) {
                // If agent doesn't exist or error occurred, fall back to database stored files
                this.logger.warn('Could not fetch agent state, using stored files:', agentError);
            }

            const cloudflareUrl = appResult.deploymentId ? buildUserWorkerUrl(env, appResult.deploymentId) : '';

            // Only the owner may see operational fields (userId, deploymentId,
            // private-repo GitHub URL). The prompt stays visible to all viewers
            // of a public app; the generated code only to those who may read
            // the source.
            const isOwner = !!userId && appResult.userId === userId;

            const [access, startedFromView, canModerate] = await Promise.all([
                AppViewController.loadListingAccess(env, appResult, userId, isOwner),
                AppViewController.loadStartedFrom(env, appResult.parentAppId),
                userId ? new UserService(env).isPlatformAdmin(userId) : Promise.resolve(false),
            ]);
            if (behaviorType === 'think' && deployedCommit && !appResult.lastDeployedAt) {
                ctx.waitUntil(appService.updateApp(appResult.id, { lastDeployedAt: new Date() }));
            }
            const reuse = AppViewController.toReuseView(appResult, access, isOwner, behaviorType, deployedCommit);
            const paidListingListed = access.listing?.status === 'listed';
            const codeVisible = canReadSource({
                visibility: appResult.visibility,
                isOwner,
                paidListingListed,
                hasPurchase: access.hasPurchase,
            });

            const responseData: AppDetailsData = {
                ...toPublicAppDetail(appResult, isOwner),
                cloudflareUrl: cloudflareUrl,
                previewUrl: previewUrl || cloudflareUrl,
                behaviorType,
                reuse,
                startedFrom: startedFromView,
                canModerate,
                removedFromDiscover:
                    (isOwner || canModerate) && appResult.removedFromDiscoverAt
                        ? { reason: appResult.removedFromDiscoverReason }
                        : null,
                codeVisible,
                cloneNeedsToken: appResult.visibility === 'private' || paidListingListed,
                user: {
                    id: isOwner ? appResult.userId! : '',
                    displayName: appResult.userName || 'Unknown',
                    avatarUrl: appResult.userAvatar
                },
                agentSummary: codeVisible ? agentSummary : null,
            };

            return AppViewController.createSuccessResponse(responseData);
        } catch (error) {
            this.logger.error('Error fetching app details:', error);
            return AppViewController.createErrorResponse<AppDetailsData>(msg('Internal server error'), 500);
        }
    }

    /** A public app's paid listing and whether the viewer bought it; reuse and source access both read it. */
    private static async loadListingAccess(
        env: Env,
        app: EnhancedAppData,
        userId: string | undefined,
        isOwner: boolean,
    ): Promise<ListingAccess> {
        if (app.visibility !== 'public') return { listing: null, hasPurchase: false };
        const listings = new TemplateService(env);
        const listing = await listings.getListingByApp(app.id);
        const hasPurchase =
            listing?.status === 'listed' && userId && !isOwner ? await listings.hasPurchase(listing.id, userId) : false;
        return { listing, hasPurchase };
    }

    private static toReuseView(
        app: EnhancedAppData,
        { listing, hasPurchase }: ListingAccess,
        isOwner: boolean,
        behaviorType: BehaviorType | null,
        deployedCommit: string | null,
    ): AppReuseView | null {
        if (app.visibility !== 'public') return null;
        const paid = listing !== null && listing.status === 'listed' && listing.currentVersionId !== null;
        const decision = reuseDecision({
            visibility: app.visibility,
            removedFromDiscover: app.removedFromDiscoverAt !== null,
            isThink: behaviorType === 'think',
            deployedCommit,
            listing: listing ? { status: listing.status, currentVersionId: listing.currentVersionId } : null,
            isOwner,
            hasPurchase,
        });
        return {
            canUse: decision.ok,
            needsPurchase: !decision.ok && decision.status === 402,
            priceCents: paid ? listing.priceCents : null,
            unavailableReason: decision.ok || decision.status === 402 ? null : decision.error,
        };
    }

    private static async loadStartedFrom(env: Env, parentAppId: string | null): Promise<StartedFromView | null> {
        if (!parentAppId) return null;
        try {
            return toStartedFromView(await new AppService(env).getStartedFrom(parentAppId));
        } catch (error) {
            AppViewController.logger.warn('Could not load the source of a copied app', error);
            return null;
        }
    }

    // Star/unstar an app
    static async toggleAppStar(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<AppStarToggleData>>> {
        try {
            const user = context.user!;

            const appId = context.pathParams.id;
            if (!appId) {
                return AppViewController.createErrorResponse<AppStarToggleData>(msg('App ID is required'), 400);
            }

            // Check if app exists and toggle star using app service
            const appService = new AppService(env);
            const app = await appService.getSingleAppWithFavoriteStatus(appId, user.id);
            if (!app) {
                return AppViewController.createErrorResponse<AppStarToggleData>(msg('App not found'), 404);
            }

            // Toggle star using app service
            const result = await appService.toggleAppStar(user.id, appId);
            
            const responseData: AppStarToggleData = result;
            return AppViewController.createSuccessResponse(responseData);
        } catch (error) {
            this.logger.error('Error toggling star:', error);
            return AppViewController.createErrorResponse<AppStarToggleData>(msg('Internal server error'), 500);
        }
    }

    // // Fork an app
    // DISABLED: Has been disabled for initial alpha release, for security reasons
    // static async forkApp(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<ForkAppData>>> {
    //     try {
    //         const user = context.user!;

    //         const appId = context.pathParams.id;
    //         if (!appId) {
    //             return AppViewController.createErrorResponse<ForkAppData>('App ID is required', 400);
    //         }

    //         // Get original app with permission checks using app service
    //         const appService = new AppService(env);
    //         const { app: originalApp, canFork } = await appService.getAppForFork(appId, user.id);

    //         if (!originalApp) {
    //             return AppViewController.createErrorResponse<ForkAppData>('App not found', 404);
    //         }

    //         if (!canFork) {
    //             return AppViewController.createErrorResponse<ForkAppData>('App not found', 404);
    //         }

    //         // Duplicate agent state first
    //         try {
    //             const { newAgentId } = await cloneAgent(env, appId, this.logger);
    //             this.logger.info(`Successfully duplicated agent state from ${appId} to ${newAgentId}`);

    //             // Create forked app using app service
    //             const forkedApp = await appService.createForkedApp(originalApp, newAgentId, user.id);
                
    //             const responseData: ForkAppData = {
    //                 forkedAppId: forkedApp.id,
    //                 message: 'App forked successfully'
    //             };

    //             return AppViewController.createSuccessResponse(responseData);
    //         } catch (error) {
    //             this.logger.error('Failed to duplicate agent state:', error);
    //             return AppViewController.createErrorResponse<ForkAppData>('Failed to duplicate agent state', 500);
    //         }
    //     } catch (error) {
    //         this.logger.error('Error forking app:', error);
    //         return AppViewController.createErrorResponse<ForkAppData>('Internal server error', 500);
    //     }
    // }

    /**
     * Generate short-lived token for git clone (private repos only)
     * POST /api/apps/:id/git/token
     */
    static async generateGitCloneToken(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext
    ): Promise<ControllerResponse<ApiResponse<GitCloneTokenData>>> {
        try {
            const user = context.user!;
            const appId = context.pathParams.id;
            
            if (!appId) {
                return AppViewController.createErrorResponse<GitCloneTokenData>(msg('App ID is required'), 400);
            }

            // Generate short-lived JWT (1 hour)
            const jwtUtils = JWTUtils.getInstance(env);
            const expiresIn = 3600; // 1 hour
            const token = await jwtUtils.createToken({
                sub: user.id,
                email: user.email,
                type: 'access' as const,
                sessionId: 'git-clone-' + appId, // Special session for git operations
            }, expiresIn);

            const responseData: GitCloneTokenData = {
                token,
                expiresIn,
                expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
                cloneUrl: buildGitCloneUrl(env, appId, token)
            };

            return AppViewController.createSuccessResponse(responseData);
        } catch (error) {
            this.logger.error('Error generating git clone token:', error);
            return AppViewController.createErrorResponse<GitCloneTokenData>(msg('Failed to generate token'), 500);
        }
    }

    /**
     * Generate a short-lived, deployment-scoped owner-preview token so the owner
     * can open a PRIVATE deployed app's URL on a preview subdomain (where the
     * main-domain session cookie is not sent).
     * POST /api/apps/:id/preview-token  (OWNER ONLY)
     */
    static async generatePreviewToken(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext
    ): Promise<ControllerResponse<ApiResponse<PreviewTokenData>>> {
        try {
            const user = context.user!;
            const appId = context.pathParams.id;

            if (!appId) {
                return AppViewController.createErrorResponse<PreviewTokenData>(msg('App ID is required'), 400);
            }

            const appService = new AppService(env);
            const app = await appService.getAppDetails(appId, user.id);

            if (!app) {
                return AppViewController.createErrorResponse<PreviewTokenData>(msg('App not found'), 404);
            }
            if (app.userId !== user.id) {
                return AppViewController.createErrorResponse<PreviewTokenData>(msg('App not found'), 404);
            }
            if (!app.deploymentId) {
                return AppViewController.createErrorResponse<PreviewTokenData>(msg('App is not deployed'), 400);
            }

            const token = await signOwnerPreviewToken(env, {
                userId: user.id,
                deploymentId: app.deploymentId,
            });

            const base = buildUserWorkerUrl(env, app.deploymentId);
            const previewUrl = `${base}/?${OWNER_PREVIEW_QUERY_PARAM}=${encodeURIComponent(token)}`;

            const responseData: PreviewTokenData = {
                token,
                expiresIn: OWNER_PREVIEW_TOKEN_TTL_SECONDS,
                expiresAt: new Date(Date.now() + OWNER_PREVIEW_TOKEN_TTL_SECONDS * 1000).toISOString(),
                previewUrl,
            };

            return AppViewController.createSuccessResponse(responseData);
        } catch (error) {
            this.logger.error('Error generating preview token:', error);
            return AppViewController.createErrorResponse<PreviewTokenData>(msg('Failed to generate token'), 500);
        }
    }

}