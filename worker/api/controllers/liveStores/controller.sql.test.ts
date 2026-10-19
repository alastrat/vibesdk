/**
 * The live store controller on real SQL, with SpaceDO stood in: an address is checked before the build is published,
 * a race lost after it answers "taken", and the panel's view comes back from what was saved. Each test's writes are
 * rolled back after it.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertApp, insertUser, migratedD1 } from '../../../database/test-support/real-d1';
import { LiveStoreController } from './controller';
import type { RouteContext } from '../../types/route-context';

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
	it('publishes the previewed build at a free address and answers the live view', async () => {
		const { namespace, published } = spaces();
		const response = await publishAs('app_tea', 'northwind-tea', namespace);
		expect(response.status).toBe(200);
		expect((await bodyOf(response)).data).toMatchObject({ status: 'live', slug: 'northwind-tea', url: 'https://northwind-tea.stores.example' });
		expect(published).toEqual(['app_tea']);
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
