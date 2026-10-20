/**
 * The live store controller on real SQL, with SpaceDO stood in: an address is checked before the build is published,
 * a race lost after it answers "taken", and the panel's view comes back from what was saved. Each test's writes are
 * rolled back after it.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { envWith, insertApp, insertUser, migratedD1 } from '../../../database/test-support/real-d1';
import { LiveStoreController } from './controller';
import type { RouteContext } from '../../types/route-context';
import { LiveStoreService } from '../../../database/services/LiveStoreService';
import { CUSTOM_DOMAINS_PAUSED_MESSAGE, STORE_PUBLISHING_PAUSED_MESSAGE } from '../../../../shared/types/pauses';

/** The agent's calls to clear a leftover merge, in order with SpaceDO's publishes when a test records those too. */
const calls = vi.hoisted((): string[] => []);

/** How the agent fails in a test: `lookup` throws when the stub is fetched, `cancel` when the cleanup call runs. */
const agentFailure = vi.hoisted((): { mode: 'none' | 'lookup' | 'cancel' } => ({ mode: 'none' }));

// The agents module pulls in the Durable Object classes, which the test runtime can't load.
vi.mock('../../../agents', () => ({
	getAgentStub: async (_env: unknown, appId: string) => {
		if (agentFailure.mode === 'lookup') throw new Error('agent unreachable');
		return {
			cancelLeftoverMerge: async () => {
				if (agentFailure.mode === 'cancel') throw new Error('agent call failed');
				calls.push(`cancel:${appId}`);
			},
		};
	},
}));

let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'seller_1');
	await insertUser(db, 'seller_2');
	await insertApp(db, { id: 'app_tea', userId: 'seller_1', title: 'Northwind Tea' });
	await insertApp(db, { id: 'app_home', userId: 'seller_2', title: 'Lumen Home' });
});

/** SpaceDO as the controller sees it, recording each publish; `duringPublish` runs as if another request raced it. */
function spaces(duringPublish?: () => Promise<void>) {
	const published: string[] = [];
	const namespace = {
		idFromName: (name: string) => name,
		get: (appId: string) => ({
			publishDraft: async (draftId?: string) => {
				published.push(draftId ? `${appId}:${draftId}` : appId);
				await duringPublish?.();
				return { commitHash: 'c0ffee1', storeManifest: null, draftId: draftId ?? 'main', draftName: draftId ? 'Typo fix' : 'Main' };
			},
			getPublishContext: async () => ({ active: { id: 'main', name: 'Main', tip: 'c0ffee1' }, publishedDraft: null }),
			getStoreManifest: async () => ({ commitHash: 'c0ffee1', manifest: null }),
		}),
	};
	return { namespace, published };
}

function publishAs(appId: string, slug: string, namespace: unknown, draftId?: string) {
	const env = envWith(db, { STORES_DOMAIN: 'stores.example', CUSTOM_DOMAIN: 'estori.app', ENVIRONMENT: 'prod', JWT_SECRET: 'live-store-controller-test-secret-0123', SPACE_DO: namespace });
	const request = new Request(`https://estori.app/api/stores/${appId}/live/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draftId ? { slug, draftId } : { slug }) });
	return LiveStoreController.publish(request, env, {} as ExecutionContext, { pathParams: { id: appId } } as unknown as RouteContext);
}

async function bodyOf(response: Response): Promise<{ success: boolean; data?: { status: string; slug: string; url: string }; error?: { message?: string } | string }> {
	return response.json();
}

describe('publishing a live store', () => {
	beforeEach(() => {
		calls.length = 0;
		agentFailure.mode = 'none';
	});

	it('publishes the previewed build at a free address and answers the live view', async () => {
		const { namespace, published } = spaces();
		const response = await publishAs('app_tea', 'northwind-tea', namespace);
		expect(response.status).toBe(200);
		expect((await bodyOf(response)).data).toMatchObject({ status: 'live', slug: 'northwind-tea', url: 'https://northwind-tea.stores.example' });
		expect(published).toEqual(['app_tea']);
		const row = await db.prepare("SELECT slug, status, published_commit FROM live_stores WHERE app_id = 'app_tea'").first();
		expect(row).toEqual({ slug: 'northwind-tea', status: 'live', published_commit: 'c0ffee1' });
	});

	it("clears a merge a crashed turn left behind before publishing, so it can't block the seller", async () => {
		const { namespace, published } = spaces(async () => {
			calls.push('publish');
		});
		const response = await publishAs('app_tea', 'northwind-tea', namespace, 'k3x9q2mf');
		expect(response.status).toBe(200);
		expect(published).toEqual(['app_tea:k3x9q2mf']);
		expect(calls).toEqual(['cancel:app_tea', 'publish']);
	});

	it.each([
		['the agent cannot be reached', 'lookup'],
		['the agent call throws', 'cancel'],
	] as const)('still publishes when %s, since the leftover-merge cleanup is only a courtesy', async (_label, mode) => {
		agentFailure.mode = mode;
		const { namespace, published } = spaces();
		const response = await publishAs('app_tea', 'northwind-tea', namespace, 'k3x9q2mf');
		expect(response.status).toBe(200);
		expect(published).toEqual(['app_tea:k3x9q2mf']);
		const row = await db.prepare("SELECT slug, status, published_commit FROM live_stores WHERE app_id = 'app_tea'").first();
		expect(row).toEqual({ slug: 'northwind-tea', status: 'live', published_commit: 'c0ffee1' });
	});

	it('publishes the draft the seller picked', async () => {
		const { namespace, published } = spaces();
		const response = await publishAs('app_tea', 'northwind-fix', namespace, 'k3x9q2mf');
		expect(response.status).toBe(200);
		expect(published).toEqual(['app_tea:k3x9q2mf']);
		expect((await bodyOf(response)).data).toMatchObject({ status: 'live', slug: 'northwind-fix' });
		const row = await db.prepare("SELECT published_commit FROM live_stores WHERE app_id = 'app_tea'").first();
		expect(row).toEqual({ published_commit: 'c0ffee1' });
	});

	it("answers 404 when the draft the seller picked doesn't exist, and 409 for SpaceDO's other refusals", async () => {
		const refusing = (error: string) => ({
			idFromName: (name: string) => name,
			get: () => ({
				publishDraft: async () => ({ error }),
				getPublishContext: async () => ({ active: { id: 'main', name: 'Main', tip: 'c0ffee1' }, publishedDraft: null }),
				getStoreManifest: async () => null,
			}),
		});
		const missing = await publishAs('app_tea', 'northwind-gone', refusing("That draft doesn't exist."), 'gone0001');
		expect(missing.status).toBe(404);
		const failing = await publishAs('app_tea', 'northwind-broken', refusing("This draft's preview doesn't build. Fix it before publishing."), 'k3x9q2mf');
		expect(failing.status).toBe(409);
		expect(await db.prepare("SELECT app_id FROM live_stores WHERE app_id = 'app_tea'").first()).toBeNull();
	});

	it("refuses an address another store holds before publishing anything, so the build isn't replaced", async () => {
		await db.prepare("INSERT INTO live_stores (app_id, slug, status, published_commit, published_at, created_at, updated_at) VALUES ('app_home', 'northwind-tea', 'live', 'abc', 0, 0, 0)").run();
		const { namespace, published } = spaces();
		const response = await publishAs('app_tea', 'northwind-tea', namespace);
		expect(response.status).toBe(409);
		expect(published).toEqual([]);
	});

	it('answers "taken" when another store takes the address while this build publishes', async () => {
		const { namespace, published } = spaces(async () => {
			await db.prepare("INSERT INTO live_stores (app_id, slug, status, published_commit, published_at, created_at, updated_at) VALUES ('app_home', 'northwind-tea', 'live', 'abc', 0, 0, 0)").run();
		});
		const response = await publishAs('app_tea', 'northwind-tea', namespace);
		expect(response.status).toBe(409);
		expect(published).toEqual(['app_tea']);
		expect(await db.prepare("SELECT app_id FROM live_stores WHERE app_id = 'app_tea'").first()).toBeNull();
	});
});

describe('while publishing or new domains are paused', () => {
	const owner = (appId: string) => ({ pathParams: { id: appId }, user: { id: 'seller_1' } }) as unknown as RouteContext;
	const envPausing = (pauses: string, namespace: unknown) =>
		envWith(db, { STORES_DOMAIN: 'stores.example', CUSTOM_DOMAIN: 'estori.app', JWT_SECRET: 'live-store-controller-test-secret-0123', SPACE_DO: namespace, FEATURE_FLAG_OVERRIDES: pauses });
	const post = (path: string, body: unknown) => new Request(`https://estori.app${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

	beforeEach(() => {
		calls.length = 0;
		agentFailure.mode = 'none';
	});

	it('refuses Go live and republishing, publishing nothing and asking no agent', async () => {
		const { namespace, published } = spaces();
		const response = await LiveStoreController.publish(post('/api/stores/app_tea/live/publish', { slug: 'northwind-tea' }), envPausing('store-publishing-paused=on', namespace), {} as ExecutionContext, owner('app_tea'));
		expect(response.status).toBe(503);
		expect(JSON.stringify(await response.json())).toContain(STORE_PUBLISHING_PAUSED_MESSAGE);
		expect(published).toEqual([]);
		expect(calls).toEqual([]);
	});

	it('refuses connecting a new domain, storing nothing', async () => {
		const { namespace } = spaces();
		const env = envPausing('custom-domains-paused=on', namespace);
		const response = await LiveStoreController.addDomain(post('/api/stores/app_tea/live/domain', { hostname: 'shop.northwind.example' }), env, {} as ExecutionContext, owner('app_tea'));
		expect(response.status).toBe(503);
		expect(JSON.stringify(await response.json())).toContain(CUSTOM_DOMAINS_PAUSED_MESSAGE);
		expect(await new LiveStoreService(env).domainOfApp('app_tea')).toBeNull();
	});

	it('still publishes while only new domains are paused', async () => {
		const { namespace, published } = spaces();
		const response = await LiveStoreController.publish(post('/api/stores/app_tea/live/publish', { slug: 'northwind-tea' }), envPausing('custom-domains-paused=on', namespace), {} as ExecutionContext, owner('app_tea'));
		expect(response.status).toBe(200);
		expect(published).toEqual(['app_tea']);
	});
});
