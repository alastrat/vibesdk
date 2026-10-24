import { beforeAll, describe, expect, it, vi } from 'vitest';
import { envWith, insertApp, insertUser, migratedD1 } from '../../../database/test-support/real-d1';
import { LiveStoreService } from '../../../database/services/LiveStoreService';
import type { RouteContext } from '../../types/route-context';
import { StoreWorkspaceController } from './controller';
import { createExecutionContext } from 'cloudflare:test';
import { Hono } from 'hono';
import type { AppEnv } from '../../../types/appenv';
import { setupStoreWorkspaceRoutes } from '../../routes/storeWorkspaceRoutes';

// Ticket auth imports agent classes unsupported by this runtime; these requests never use tickets.
vi.mock('../../../agents', () => ({ getAgentStub: vi.fn() }));

let db: D1Database;
const manifest = JSON.stringify({
	version: 1, currency: 'usd', shipping: { countries: ['US'], flatRateCents: 0 },
	products: [{ id: 'tea', name: 'Tea', description: 'Whole leaf', image: '/tea.jpg', variants: [
		{ id: 'green', name: 'Green', priceCents: 1400 },
		{ id: 'black', name: 'Black', priceCents: 1600, available: false, catalogVariantId: 'supplier-1' },
	] }],
});
beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'seller');
	await insertUser(db, 'other');
	await insertApp(db, { id: 'tea', userId: 'seller' });
});

function read(options: { userId?: string | null; raw?: string | null; missing?: boolean; unavailable?: boolean; commit?: string } = {}) {
	const branches: string[] = [];
	const namespace = {
		idFromName: (id: string) => id,
		get: () => ({ getStoreManifest: async (branch: string) => {
			branches.push(branch);
			if (options.unavailable) throw new Error('private upstream failure');
			return options.missing ? null : { commitHash: options.commit ?? 'published-1', manifest: options.raw === undefined ? manifest : options.raw };
		} }),
	};
	const env = envWith(db, { SPACE_DO: namespace, STORES_DOMAIN: 'shops.example', CUSTOM_DOMAIN: 'estori.example', ENVIRONMENT: 'prod' });
	const userId = options.userId === undefined ? 'seller' : options.userId;
	const context = { pathParams: { id: 'tea' }, user: userId ? { id: userId, email: `${userId}@example.test`, locale: null } : null } as RouteContext;
	return { branches, response: StoreWorkspaceController.products(new Request('https://estori.example/api/stores/tea/products'), env, {} as ExecutionContext, context) };
}

async function publish() {
	await new LiveStoreService(envWith(db)).publish({ appId: 'tea', slug: 'tea', commit: 'published-1', now: new Date('2026-10-20T12:00:00Z') });
}

describe('published store collection', () => {
	it('returns only validated published product fields, resolved images and provenance', async () => {
		await publish();
		const result = read();
		const response = await result.response;
		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toBe('private, no-store');
		const body = await response.json();
		expect(body).toMatchObject({ success: true, data: {
			manifestStatus: 'ready', status: 'live', source: 'published', publishedCommit: 'published-1', publishedAt: '2026-10-20T12:00:00.000Z',
			products: [{ id: 'tea', name: 'Tea', description: 'Whole leaf', imageUrl: 'https://tea.shops.example/tea.jpg', variants: [
				{ id: 'green', name: 'Green', priceCents: 1400, available: true, kind: 'own' },
				{ id: 'black', name: 'Black', priceCents: 1600, available: false, kind: 'catalog' },
			] }],
		} });
		expect(JSON.stringify(body)).not.toContain('shipping');
		expect(JSON.stringify(body)).not.toContain('supplier-1');
		expect(result.branches).toEqual(['live']);
	});

	it.each([null, 'other'])('refuses viewer %s before reading a manifest', async (userId) => {
		await publish();
		const result = read({ userId });
		expect((await result.response).status).toBe(userId ? 403 : 401);
		expect(result.branches).toEqual([]);
	});

	it('the HTTP route refuses another seller even when the store is public', async () => {
		await db.prepare("UPDATE apps SET visibility = 'public' WHERE id = 'tea'").run();
		const app = new Hono<AppEnv>();
		app.use('*', async (context, next) => {
			context.set('user', { id: 'other', email: 'other@example.test', locale: null });
			await next();
		});
		setupStoreWorkspaceRoutes(app);
		const response = await app.fetch(new Request('https://estori.example/api/stores/tea/products'), envWith(db), createExecutionContext());
		expect(response.status).toBe(403);
		expect(JSON.stringify(await response.json())).not.toContain('Whole leaf');
	});

	it('does not substitute draft products before the first publish', async () => {
		const result = read();
		const body = await (await result.response).json();
		expect(body).toMatchObject({ data: { manifestStatus: 'unpublished', status: 'unpublished', products: [], publishedAt: null, publishedCommit: null } });
		expect(result.branches).toEqual([]);
	});

	it.each([
		[null, 'missing'],
		['{"private":"broken"}', 'invalid'],
	] as const)('reports an absent or invalid manifest without leaking its contents', async (raw, manifestStatus) => {
		await publish();
		const response = await read({ raw }).response;
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toMatchObject({ data: { manifestStatus, products: [] } });
		expect(JSON.stringify(body)).not.toContain('broken');
	});

	it.each([{ missing: true }, { unavailable: true }, { commit: 'in-flight-publish' }])('does not mislabel missing, unreadable or mismatched deployments as empty collections: %j', async (options) => {
		await publish();
		const response = await read(options).response;
		expect(response.status).toBe(503);
		expect(JSON.stringify(await response.json())).not.toContain('private upstream failure');
	});

	it('labels an offline collection as the last published version and omits its live address', async () => {
		await publish();
		await new LiveStoreService(envWith(db)).setOffline('tea', new Date());
		const body = await (await read().response).json();
		expect(body).toMatchObject({ data: { status: 'offline', storeUrl: null, products: [{ imageUrl: null }] } });
	});
});
