/** Plan limits at Go live and on own domains, on real SQL with SpaceDO stood in. */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { envWith, insertApp, insertSubscription, insertUser, migratedD1 } from '../../../database/test-support/real-d1';
import { LiveStoreService } from '../../../database/services/LiveStoreService';
import { NEW_CATALOG_PRODUCTS_ERROR } from '../../../../shared/types/billing';
import { LiveStoreController } from './controller';
import type { RouteContext } from '../../types/route-context';

vi.mock('../../../agents', () => ({ getAgentStub: async () => ({ cancelLeftoverMerge: async () => undefined }) }));

let db: D1Database;
const DAY = 86_400_000;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'u_basic');
	await insertUser(db, 'u_pro');
	await insertSubscription(db, { userId: 'u_pro', stripeSubscriptionId: 'sub_pro', status: 'active', plan: 'pro', currentPeriodStart: new Date(Date.now() - DAY), currentPeriodEnd: new Date(Date.now() + 29 * DAY) });
	for (const [id, userId] of [['app_live', 'u_basic'], ['app_next', 'u_basic'], ['app_pro_1', 'u_pro'], ['app_pro_2', 'u_pro']] as const) await insertApp(db, { id, userId });
});

/** SpaceDO as the controller sees it; `addsCatalog` makes the draft add catalog products. */
function spaces(addsCatalog = false) {
	const published: Array<{ appId: string; refuseNewCatalogProducts: boolean }> = [];
	const namespace = {
		idFromName: (name: string) => name,
		get: (appId: string) => ({
			publishDraft: async (_draftId?: string, options?: { refuseNewCatalogProducts?: boolean }) => {
				published.push({ appId, refuseNewCatalogProducts: options?.refuseNewCatalogProducts === true });
				if (addsCatalog && options?.refuseNewCatalogProducts) return { error: NEW_CATALOG_PRODUCTS_ERROR };
				return { commitHash: 'c0ffee1', storeManifest: null, draftId: 'main', draftName: 'Main' };
			},
			getPublishContext: async () => ({ active: { id: 'main', name: 'Main', tip: 'c0ffee1' }, publishedDraft: null }),
			getStoreManifest: async () => ({ commitHash: 'c0ffee1', manifest: null }),
		}),
	};
	return { namespace, published };
}

function call(method: 'publish' | 'addDomain', appId: string, userId: string, namespace: unknown, extra: Record<string, unknown> = { BILLING: 'on' }) {
	const env = envWith(db, { STORES_DOMAIN: 'stores.example', CUSTOM_DOMAIN: 'estori.app', ENVIRONMENT: 'prod', JWT_SECRET: 'live-store-billing-test-secret-0123', SPACE_DO: namespace, ...extra });
	const body = method === 'publish' ? { slug: appId.replace(/_/g, '-') } : { hostname: 'shop.example.com' };
	const request = new Request(`https://estori.app/api/stores/${appId}/live/${method === 'publish' ? 'publish' : 'domain'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
	return LiveStoreController[method](request, env, {} as ExecutionContext, { pathParams: { id: appId }, user: { id: userId } } as unknown as RouteContext);
}

describe('plan limits at Go live', () => {
	it("republishes Basic's live store, and refuses a second live store before anything is published", async () => {
		await new LiveStoreService(envWith(db)).publish({ appId: 'app_live', slug: 'app-live', commit: 'c0ffee0', now: new Date() });
		const { namespace, published } = spaces();
		expect((await call('publish', 'app_live', 'u_basic', namespace)).status).toBe(200);
		const refused = await call('publish', 'app_next', 'u_basic', namespace);
		expect(refused.status).toBe(402);
		expect((await refused.json()).error.planLimit).toMatchObject({ limit: 'liveStores', plan: 'basic', upgradeTo: 'pro' });
		expect(published.map((entry) => entry.appId)).toEqual(['app_live']);
	});

	it("frees a live store's place when it goes offline, and counts only the account's own stores", async () => {
		const stores = new LiveStoreService(envWith(db));
		await stores.publish({ appId: 'app_live', slug: 'app-live', commit: 'c0ffee0', now: new Date() });
		await stores.publish({ appId: 'app_pro_2', slug: 'app-pro-2', commit: 'c0ffee0', now: new Date() });
		expect(await stores.liveCountOf('u_basic')).toBe(1);
		await stores.setOffline('app_live', new Date());
		expect(await stores.liveCountOf('u_basic')).toBe(0);
		const { namespace, published } = spaces();
		expect((await call('publish', 'app_next', 'u_basic', namespace)).status).toBe(200);
		expect((await call('publish', 'app_live', 'u_basic', namespace)).status).toBe(402);
		expect(published.map((entry) => entry.appId)).toEqual(['app_next']);
	});

	it('asks SpaceDO to refuse new catalog products without the catalog, and answers with the plan limit', async () => {
		await new LiveStoreService(envWith(db)).publish({ appId: 'app_live', slug: 'app-live', commit: 'c0ffee0', now: new Date() });
		const basic = spaces(true);
		const refused = await call('publish', 'app_live', 'u_basic', basic.namespace);
		expect(refused.status).toBe(402);
		expect((await refused.json()).error.planLimit).toMatchObject({ limit: 'supplierCatalog', message: 'Adding catalog products to your store comes with Pro and Premium. Products already live keep selling.' });
		const pro = spaces(true);
		expect((await call('publish', 'app_pro_1', 'u_pro', pro.namespace)).status).toBe(200);
		expect(pro.published).toEqual([{ appId: 'app_pro_1', refuseNewCatalogProducts: false }]);
	});

	it('refuses an own domain on Basic, and changes nothing while billing is off', async () => {
		const { namespace, published } = spaces(true);
		const domain = await call('addDomain', 'app_live', 'u_basic', namespace);
		expect(domain.status).toBe(402);
		expect((await domain.json()).error.planLimit).toMatchObject({ limit: 'ownDomainsPerLiveStore', message: 'Own domains come with Pro and Premium.' });
		expect((await call('addDomain', 'app_live', 'u_basic', namespace, {})).status).not.toBe(402);
		expect((await call('publish', 'app_next', 'u_basic', namespace, {})).status).toBe(200);
		expect(published).toEqual([{ appId: 'app_next', refuseNewCatalogProducts: false }]);
	});

	it("leaves a Pro store's second domain to the domain checks, and refuses own domains when an override zeroes them", async () => {
		await new LiveStoreService(envWith(db)).addDomain({ appId: 'app_pro_2', hostname: 'shop.pro.example', provider: 'local', providerId: null, records: [], now: new Date() });
		const { namespace } = spaces();
		const second = await call('addDomain', 'app_pro_2', 'u_pro', namespace, { BILLING: 'on', ENVIRONMENT: 'dev' });
		expect(second.status).toBe(400);
		expect((await second.json()).error).toMatchObject({ message: 'This store already has a domain. Remove it to connect another.' });
		expect((await call('addDomain', 'app_pro_1', 'u_pro', namespace)).status).not.toBe(402);
		await db
			.prepare("INSERT INTO plan_overrides (id, user_id, plan, limits, until, admin_user_id, reason, created_at) VALUES ('po_domains', 'u_pro', 'pro', ?, NULL, 'u_basic', 'No own domains', ?)")
			.bind(JSON.stringify({ ownDomainsPerLiveStore: 0 }), Math.floor(Date.now() / 1000))
			.run();
		const zeroed = await call('addDomain', 'app_pro_1', 'u_pro', namespace);
		expect(zeroed.status).toBe(402);
		expect((await zeroed.json()).error.planLimit).toMatchObject({ limit: 'ownDomainsPerLiveStore', plan: 'pro', message: "Own domains aren't on your plan. Talk to us to add them." });
	});
});
