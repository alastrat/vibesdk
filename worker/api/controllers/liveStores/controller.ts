/** A store's live address and its own domain, for the app's owner: publish, take offline, connect a domain. */

import { BaseController } from '../baseController';
import type { RouteContext } from '../../types/route-context';
import type { ApiResponse, ControllerResponse } from '../types';
import { AppService } from '../../../database/services/AppService';
import { LiveStoreService } from '../../../database/services/LiveStoreService';
import { slugProblem, type LiveStoreView } from '../../../../shared/types/live-stores';
import { storeHostConfig } from '../../../services/live-stores/hosts';
import { devPortOf, liveStoreView } from '../../../services/live-stores/view';
import { addStoreDomain, checkStoreDomain, removeStoreDomain } from '../../../services/live-stores/domain-checks';
import { domainFlowDepsFromEnv } from '../../../services/live-stores/wiring';
import { takeStoreOffline } from '../../../services/live-stores/take-offline';
import { StoreCheckoutService } from '../../../database/services/StoreCheckoutService';
import { stripeFromEnv } from '../../../services/payments/config';

interface LiveSpaceStub {
    publishLive(): Promise<{ commitHash: string; storeManifest: string | null } | { error: string }>;
    getStoreManifest(branch: string): Promise<{ commitHash: string; manifest: string | null } | null>;
}

function spaceOf(env: Env, appId: string): LiveSpaceStub | null {
    const namespace = (env as unknown as { SPACE_DO?: DurableObjectNamespace }).SPACE_DO;
    return namespace ? (namespace.get(namespace.idFromName(appId)) as unknown as LiveSpaceStub) : null;
}

async function viewOf(env: Env, appId: string): Promise<LiveStoreView> {
    const stores = new LiveStoreService(env);
    const space = spaceOf(env, appId);
    const [app, record, domain, preview, published] = await Promise.all([
        new AppService(env).getAppDetails(appId),
        stores.getByApp(appId),
        stores.domainOfApp(appId),
        space?.getStoreManifest('main') ?? null,
        space?.getStoreManifest('live') ?? null,
    ]);
    return liveStoreView({
        appId,
        title: app?.title ?? '',
        storesDomain: storeHostConfig(env).storesDomain,
        devPort: devPortOf(env.CUSTOM_DOMAIN),
        domainsAvailable: domainFlowDepsFromEnv(env).provider !== null,
        record,
        previewCommit: preview?.commitHash ?? null,
        publishedManifest: published?.manifest ?? null,
        domain,
    });
}

export class LiveStoreController extends BaseController {
    static async get(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<LiveStoreView>>> {
        const appId = context.pathParams.id;
        if (!appId) return this.createErrorResponse<LiveStoreView>('Store not found', 404);
        try {
            return this.createSuccessResponse(await viewOf(env, appId));
        } catch (error) {
            return this.handleError(error, "read the store's address") as ControllerResponse<ApiResponse<LiveStoreView>>;
        }
    }

    /** Publishes the previewed version at the slug, which the first publish takes and a later one may change. */
    static async publish(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<LiveStoreView>>> {
        const appId = context.pathParams.id;
        if (!appId) return this.createErrorResponse<LiveStoreView>('Store not found', 404);
        try {
            if (!storeHostConfig(env).storesDomain) return this.createErrorResponse<LiveStoreView>("Store addresses aren't set up yet.", 409);
            const body = await this.parseJsonBody<{ slug?: unknown }>(request);
            const slug = body.success && typeof body.data?.slug === 'string' ? body.data.slug.trim().toLowerCase() : '';
            const problem = slugProblem(slug);
            if (problem) return this.createErrorResponse<LiveStoreView>(problem, 400);
            const stores = new LiveStoreService(env);
            const holder = await stores.slugHolder(slug);
            if (holder && holder !== appId) return this.createErrorResponse<LiveStoreView>('That address is taken. Try another.', 409);

            const space = spaceOf(env, appId);
            if (!space) return this.createErrorResponse<LiveStoreView>("This store can't be published right now.", 503);
            const published = await space.publishLive();
            if ('error' in published) return this.createErrorResponse<LiveStoreView>(published.error, 409);
            const saved = await stores.publish({ appId, slug, commit: published.commitHash, now: new Date() });
            if (saved === 'slug-taken') return this.createErrorResponse<LiveStoreView>('That address is taken. Try another.', 409);
            return this.createSuccessResponse(await viewOf(env, appId));
        } catch (error) {
            return this.handleError(error, 'publish the store') as ControllerResponse<ApiResponse<LiveStoreView>>;
        }
    }

    static async offline(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<LiveStoreView>>> {
        const appId = context.pathParams.id;
        if (!appId) return this.createErrorResponse<LiveStoreView>('Store not found', 404);
        try {
            const stripe = stripeFromEnv(env);
            const checkouts = new StoreCheckoutService(env);
            await takeStoreOffline({
                setOffline: () => new LiveStoreService(env).setOffline(appId, new Date()),
                openCheckouts: () => checkouts.openCheckoutsOfApp(appId),
                expireSession: async (sessionId) => {
                    if (!stripe) throw new Error('Stripe is not configured');
                    await stripe.expireCheckoutSession(sessionId);
                },
                markExpired: (checkoutId) => checkouts.expire(checkoutId),
            });
            return this.createSuccessResponse(await viewOf(env, appId));
        } catch (error) {
            return this.handleError(error, 'take the store offline') as ControllerResponse<ApiResponse<LiveStoreView>>;
        }
    }

    static async addDomain(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<LiveStoreView>>> {
        const appId = context.pathParams.id;
        if (!appId) return this.createErrorResponse<LiveStoreView>('Store not found', 404);
        try {
            const body = await this.parseJsonBody<{ hostname?: unknown }>(request);
            const hostname = body.success && typeof body.data?.hostname === 'string' ? body.data.hostname : '';
            const added = await addStoreDomain(domainFlowDepsFromEnv(env), appId, hostname);
            if (!added.ok) return this.createErrorResponse<LiveStoreView>(added.message, 400);
            return this.createSuccessResponse(await viewOf(env, appId));
        } catch (error) {
            return this.handleError(error, 'add the domain') as ControllerResponse<ApiResponse<LiveStoreView>>;
        }
    }

    static async checkDomain(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<LiveStoreView>>> {
        const appId = context.pathParams.id;
        if (!appId) return this.createErrorResponse<LiveStoreView>('Store not found', 404);
        try {
            const checked = await checkStoreDomain(domainFlowDepsFromEnv(env), appId);
            if (!checked.ok) return this.createErrorResponse<LiveStoreView>(checked.message, 400);
            return this.createSuccessResponse(await viewOf(env, appId));
        } catch (error) {
            return this.handleError(error, 'check the domain') as ControllerResponse<ApiResponse<LiveStoreView>>;
        }
    }

    static async removeDomain(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<LiveStoreView>>> {
        const appId = context.pathParams.id;
        if (!appId) return this.createErrorResponse<LiveStoreView>('Store not found', 404);
        try {
            const removed = await removeStoreDomain(domainFlowDepsFromEnv(env), appId);
            if (!removed.ok) return this.createErrorResponse<LiveStoreView>(removed.message, 502);
            return this.createSuccessResponse(await viewOf(env, appId));
        } catch (error) {
            return this.handleError(error, 'remove the domain') as ControllerResponse<ApiResponse<LiveStoreView>>;
        }
    }
}
