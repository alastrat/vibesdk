import { msg } from '../../../../shared/i18n/translate';
/** Public product pages for Discover sites and their approved screenshots. Drafting lives in draftController.ts. */

import { BaseController } from '../baseController';
import type { ApiResponse, ControllerResponse } from '../types';
import type { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';
import { AppService, SitePageService, TemplateService } from '../../../database';
import { getAgentStubLightweight } from '../../../agents';
import { RateLimitService } from '../../../services/rate-limit/rateLimits';
import { RateLimitExceededError } from 'shared/types/errors';
import { ScreenshotSecurity } from '../../../utils/screenshot-security';
import { isTemplateShotKind } from '../../../services/templates/catalog';
import { templateImageResponse } from '../../../services/templates/store';
import { SITE_PAGE_UNAVAILABLE_MESSAGE } from '../../../../shared/types/site-page';
import { recordVisit } from '../appView/record-visit';
import { approvedShotKey, toSitePageData } from './sitePageDto';
import type { SitePageData } from './types';

const MORE_FROM_CREATOR_LIMIT = 4;
const SITE_SCREENSHOT_CACHE = 'public, max-age=86400';

export class SitePageController extends BaseController {
    static logger = createLogger('SitePageController');

    static async getPage(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<SitePageData>>> {
        try {
            const appId = context.pathParams.appId;
            const user = await SitePageController.getOptionalUser(request, env);
            try {
                await RateLimitService.enforcePublicAppsRateLimit(env, context.config.security.rateLimit, user ?? null, request);
            } catch (error) {
                if (error instanceof RateLimitExceededError) {
                    return SitePageController.createErrorResponse<SitePageData>(msg('Too many requests'), 429);
                }
                throw error;
            }
            const apps = new AppService(env);
            const app = appId ? await apps.getAppDetails(appId, user?.id) : null;
            if (!app || app.visibility !== 'public' || app.removedFromDiscoverAt) {
                return SitePageController.createErrorResponse<SitePageData>(SITE_PAGE_UNAVAILABLE_MESSAGE, 404);
            }
            const isOwner = !!user && app.userId === user.id;
            const listings = new TemplateService(env);
            const pages = new SitePageService(env);
            const listing = await listings.getListingByApp(app.id);
            const listed = listing?.status === 'listed' ? listing : null;
            const [hasPurchase, approvedVersion, savedCopy, deployment, creatorSites] = await Promise.all([
                listed && user && !isOwner ? listings.hasPurchase(listed.id, user.id) : Promise.resolve(false),
                listed?.currentVersionId ? listings.getVersion(listed.currentVersionId) : Promise.resolve(null),
                pages.getCopy(app.id),
                SitePageController.loadDeployment(env, app.id),
                app.userId ? pages.listCreatorSites(app.userId, app.id, MORE_FROM_CREATOR_LIMIT) : Promise.resolve([]),
            ]);
            const moreFromCreator = await new ScreenshotSecurity(env).enrichUrls(creatorSites);
            await recordVisit(apps, app.id, user?.id, request);
            return SitePageController.createSuccessResponse<SitePageData>(
                toSitePageData({
                    app,
                    isOwner,
                    hasPurchase,
                    reusable: deployment.reusable,
                    listing,
                    approvedVersion,
                    savedCopy,
                    previewUrl: deployment.previewUrl,
                    moreFromCreator,
                }),
            );
        } catch (error) {
            this.logger.error('Error loading product page', error);
            return SitePageController.createErrorResponse<SitePageData>(msg('Failed to load this page'), 500);
        }
    }

    static async serveScreenshot(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<never>>> {
        try {
            const { appId, kind } = context.pathParams;
            if (!appId || !kind || !isTemplateShotKind(kind)) {
                return SitePageController.createErrorResponse(msg('Screenshot not found'), 404);
            }
            const app = await new AppService(env).getReuseSource(appId);
            if (!app || app.visibility !== 'public' || app.removedFromDiscoverAt) {
                return SitePageController.createErrorResponse(msg('Screenshot not found'), 404);
            }
            const listings = new TemplateService(env);
            const listing = await listings.getListingByApp(appId);
            const version =
                listing?.status === 'listed' && listing.currentVersionId ? await listings.getVersion(listing.currentVersionId) : null;
            const key = approvedShotKey(listing, version, kind);
            const image = key ? await templateImageResponse(env.TEMPLATES_BUCKET, key, SITE_SCREENSHOT_CACHE) : null;
            if (!image) return SitePageController.createErrorResponse(msg('Screenshot not found'), 404);
            // Binary route: the router passes this Response through unchanged.
            return image as unknown as ControllerResponse<ApiResponse<never>>;
        } catch (error) {
            this.logger.error('Error serving product page screenshot', error);
            return SitePageController.createErrorResponse(msg('Internal server error'), 500);
        }
    }

    /** Whether a free copy can start from the site, and an anonymous signed preview of it; neither when it can't be copied or reached. */
    private static async loadDeployment(env: Env, appId: string): Promise<{ reusable: boolean; previewUrl: string | null }> {
        try {
            const agent = await getAgentStubLightweight(env, appId);
            if ((await agent.getBehaviorType()) !== 'think') return { reusable: false, previewUrl: null };
            const [commit, previewUrl] = await Promise.all([agent.getDeployedCommit(), agent.getPublicPreviewURL()]);
            return { reusable: Boolean(commit), previewUrl };
        } catch (error) {
            SitePageController.logger.warn('Could not load the site preview', { appId, error });
            return { reusable: false, previewUrl: null };
        }
    }
}
