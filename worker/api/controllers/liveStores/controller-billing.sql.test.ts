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

async function call(method: 'publish' | 'addDomain', appId: string, userId: string, namespace: unknown, extra: Record<string, unknown> = { BILLING: 'on' }) {
	const env = envWith(db, { STORES_DOMAIN: 'stores.example', CUSTOM_DOMAIN: 'estori.app', ENVIRONMENT: 'prod', JWT_SECRET: 'live-store-billing-test-secret-0123', SPACE_DO: namespace, ...extra });
	const body = method === 'publish' ? { slug: appId.replace(/_/g, '-') } : { hostname: 'shop.example.com' };
	const request = new Request(`https://estori.app/api/stores/${appId}/live/${method === 'publish' ? 'publish' : 'domain'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
	// A publish queues translations after its response; they finish before the next test starts.
	const afterResponse: Promise<unknown>[] = [];
	const ctx = { waitUntil: (work: Promise<unknown>) => void afterResponse.push(work) } as unknown as ExecutionContext;
	const response = await LiveStoreController[method](request, env, ctx, { pathParams: { id: appId }, user: { id: userId } } as unknown as RouteContext);
	await Promise.all(afterResponse);
	return response;
}

describe('plan limits at Go live', () => {
	it.each([
		{ plan: 'basic', cap: 2 },
		{ plan: 'pro', cap: 5 },
		{ plan: 'premium', cap: 20 },
	] as const)('publishes all $cap stores on $plan, permits republishing, and refuses another', async ({ plan, cap }) => {
		const userId = `u_publish_${plan}`;
		await insertUser(db, userId);
		if (plan !== 'basic') await insertSubscription(db, { userId, stripeSubscriptionId: `sub_publish_${plan}`, status: 'active', plan, currentPeriodStart: new Date(Date.now() - DAY), currentPeriodEnd: new Date(Date.now() + 29 * DAY) });
		const stores = new LiveStoreService(envWith(db));
		const { namespace, published } = spaces();
		for (let i = 0; i <= cap; i++) {
			const appId = `publish_${plan}_${i}`;
			await insertApp(db, { id: appId, userId });
			const response = await call('publish', appId, userId, namespace);
			if (i < cap) expect(response.status).toBe(200);
			else {
				expect(response.status).toBe(402);
				expect((await response.json()).error.planLimit).toMatchObject({ limit: 'liveStores', plan });
			}
		}
		expect(await stores.liveCountOf(userId)).toBe(cap);
		expect(published).toHaveLength(cap);
		expect((await call('publish', `publish_${plan}_0`, userId, namespace)).status).toBe(200);
		await stores.setOffline(`publish_${plan}_0`, new Date());
		expect((await call('publish', `publish_${plan}_${cap}`, userId, namespace)).status).toBe(200);
		expect(await stores.liveCountOf(userId)).toBe(cap);
	});

	it('publishes new catalog products on Basic and Pro', async () => {
		for (const [userId, appId] of [['u_basic', 'app_live'], ['u_pro', 'app_pro_1']] as const) {
			const store = spaces(true);
			expect((await call('publish', appId, userId, store.namespace)).status).toBe(200);
			expect(store.published).toEqual([{ appId, refuseNewCatalogProducts: false }]);
		}
	});

	it('preserves an explicit account restriction on catalog publishing', async () => {
		await insertUser(db, 'u_catalog_restricted');
		await insertApp(db, { id: 'app_catalog_restricted', userId: 'u_catalog_restricted' });
		await db.prepare("INSERT INTO plan_overrides (id, user_id, plan, limits, until, admin_user_id, reason, created_at) VALUES ('po_catalog', 'u_catalog_restricted', 'basic', ?, NULL, 'u_basic', 'Catalog restriction', ?)").bind(JSON.stringify({ supplierCatalog: false }), Math.floor(Date.now() / 1000)).run();
		const store = spaces(true);
		const refused = await call('publish', 'app_catalog_restricted', 'u_catalog_restricted', store.namespace);
		expect(refused.status).toBe(402);
		expect((await refused.json()).error.planLimit).toMatchObject({ limit: 'supplierCatalog', upgradeTo: null, message: 'Catalog access is disabled for your account. Products already live keep selling. Contact support for help.' });
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
