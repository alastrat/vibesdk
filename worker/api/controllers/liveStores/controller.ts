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
import { getAgentStub } from '../../../agents';
import { draftErrorStatus } from '../../../agents/think/draft-change';
import { loadAccount, type BillingAccount } from '../../../services/billing/account';
import { assertWithinLimit } from '../../../../shared/types/plans';
import { NEW_CATALOG_PRODUCTS_ERROR } from '../../../../shared/types/billing';
import { CUSTOM_DOMAINS_PAUSED_MESSAGE, STORE_PUBLISHING_PAUSED_MESSAGE } from '../../../../shared/types/pauses';
import { isFlagOn } from '../../../services/posthog/flags';
import { serverAnalytics } from '../../../services/posthog/analytics';
import { personUpdateOf } from '../../../services/posthog/person';
import { MAIN_DRAFT_ID } from '../../../../shared/types/drafts';
import type { PublishContext, PublishDraftOptions, PublishDraftResult } from '@space-do/space';

interface LiveSpaceStub {
    publishDraft(id?: string, options?: PublishDraftOptions): Promise<PublishDraftResult>;
    getPublishContext(): Promise<PublishContext>;
    getStoreManifest(branch: string): Promise<{ commitHash: string; manifest: string | null } | null>;
}

/** The owner's plan; null without a user, which the owner-only routes always have outside tests. */
async function liveStoreAccount(env: Env, context: RouteContext): Promise<BillingAccount | null> {
    return context.user ? loadAccount(env, context.user.id) : null;
}

function spaceOf(env: Env, appId: string): LiveSpaceStub | null {
    const namespace = (env as unknown as { SPACE_DO?: DurableObjectNamespace }).SPACE_DO;
    return namespace ? (namespace.get(namespace.idFromName(appId)) as unknown as LiveSpaceStub) : null;
}

async function viewOf(env: Env, appId: string): Promise<LiveStoreView> {
    const stores = new LiveStoreService(env);
    const space = spaceOf(env, appId);
    const [app, record, domain, context, published] = await Promise.all([
        new AppService(env).getAppDetails(appId),
        stores.getByApp(appId),
        stores.domainOfApp(appId),
        space?.getPublishContext() ?? null,
        space?.getStoreManifest('live') ?? null,
    ]);
    return liveStoreView({
        appId,
        title: app?.title ?? '',
        storesDomain: storeHostConfig(env).storesDomain,
        devPort: devPortOf(env.CUSTOM_DOMAIN),
        domainsAvailable: domainFlowDepsFromEnv(env).provider !== null,
        record,
        previewCommit: context?.active.tip ?? null,
        draft: context ? { id: context.active.id, name: context.active.name } : null,
        publishedDraft: context?.publishedDraft ?? null,
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

    /** Publishes a draft (the one being edited unless the body names another) at the slug, which the first publish takes and a later one may change. */
    static async publish(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<LiveStoreView>>> {
        const appId = context.pathParams.id;
        if (!appId) return this.createErrorResponse<LiveStoreView>('Store not found', 404);
        try {
            if (await isFlagOn(env, 'store-publishing-paused', context.user?.id ?? null)) {
                return this.createErrorResponse<LiveStoreView>(STORE_PUBLISHING_PAUSED_MESSAGE, 503);
            }
            if (!storeHostConfig(env).storesDomain) return this.createErrorResponse<LiveStoreView>("Store addresses aren't set up yet.", 409);
            const body = await this.parseJsonBody<{ slug?: unknown; draftId?: unknown }>(request);
            const slug = body.success && typeof body.data?.slug === 'string' ? body.data.slug.trim().toLowerCase() : '';
            const draftId = body.success && typeof body.data?.draftId === 'string' ? body.data.draftId : undefined;
            const problem = slugProblem(slug);
            if (problem) return this.createErrorResponse<LiveStoreView>(problem, 400);
            const stores = new LiveStoreService(env);
            const holder = await stores.slugHolder(slug);
            if (holder && holder !== appId) return this.createErrorResponse<LiveStoreView>('That address is taken. Try another.', 409);

            // Republishing a live store takes no new place; one offline or never published needs a free one.
            const account = await liveStoreAccount(env, context);
            if (account?.billing && (await stores.getByApp(appId))?.status !== 'live') {
                const refusal = assertWithinLimit(account, 'liveStores', await stores.liveCountOf(account.userId));
                if (refusal) return this.createPlanLimitResponse<LiveStoreView>(refusal);
            }
            const catalogRefusal = account ? assertWithinLimit(account, 'supplierCatalog') : null;
            const refuseNewCatalogProducts = catalogRefusal !== null;

            const space = spaceOf(env, appId);
            if (!space) return this.createErrorResponse<LiveStoreView>("This store can't be published right now.", 503);
            // A merge left by a crashed turn would refuse the publish; the agent clears it unless a turn is resolving it.
            // If the agent can't be reached, SpaceDO still refuses a draft with a leftover merge on its own.
            try {
                await (await getAgentStub(env, appId)).cancelLeftoverMerge();
            } catch (error) {
                this.logger.warn('Could not clear a leftover merge before publishing; publishing anyway', { appId, error });
            }
            const firstPublish = (await stores.getByApp(appId)) === null;
            const published = await space.publishDraft(draftId, { refuseNewCatalogProducts });
            if ('error' in published) {
                if (catalogRefusal && published.error === NEW_CATALOG_PRODUCTS_ERROR) return this.createPlanLimitResponse<LiveStoreView>(catalogRefusal);
                return this.createErrorResponse<LiveStoreView>(published.error, draftErrorStatus(published.error));
            }
            const saved = await stores.publish({ appId, slug, commit: published.commitHash, now: new Date() });
            if (saved === 'slug-taken') return this.createErrorResponse<LiveStoreView>('That address is taken. Try another.', 409);
            const ownerId = context.user?.id;
            if (ownerId) {
                const draft = published.draftId === MAIN_DRAFT_ID ? 'main' : 'other';
                serverAnalytics(env).capture('store_published', ownerId, { app_id: appId, first_publish: firstPublish, draft }, await personUpdateOf(env, ownerId));
            }
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
            const ownerId = context.user?.id;
            if (ownerId) serverAnalytics(env).capture('store_unpublished', ownerId, { app_id: appId }, await personUpdateOf(env, ownerId));
            return this.createSuccessResponse(await viewOf(env, appId));
        } catch (error) {
            return this.handleError(error, 'take the store offline') as ControllerResponse<ApiResponse<LiveStoreView>>;
        }
    }

    static async addDomain(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<LiveStoreView>>> {
        const appId = context.pathParams.id;
        if (!appId) return this.createErrorResponse<LiveStoreView>('Store not found', 404);
        try {
            if (await isFlagOn(env, 'custom-domains-paused', context.user?.id ?? null)) {
                return this.createErrorResponse<LiveStoreView>(CUSTOM_DOMAINS_PAUSED_MESSAGE, 503);
            }
            // Refused only on a plan without own domains. A store holds one at most, so with an allowance the domain
            // checks below answer a store that already has one.
            const account = await liveStoreAccount(env, context);
            const refusal = account ? assertWithinLimit(account, 'ownDomainsPerLiveStore', 0) : null;
            if (refusal) return this.createPlanLimitResponse<LiveStoreView>(refusal);
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
