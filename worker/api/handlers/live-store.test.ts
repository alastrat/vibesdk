import { describe, expect, it } from 'vitest';
import { handleLiveStore } from './live-store';
import type { StoreHost } from '../../services/live-stores/hosts';
import { recordingD1 } from '../../database/test-support/recording-d1';

const CTX = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
const LIVE: StoreHost = { kind: 'subdomain', store: { appId: 'app_tea', slug: 'northwind-tea', status: 'live', sellerUserId: 'seller_1' } };

/** A SpaceDO namespace that records what it was asked for, and answers as the store would, or fails. */
function spaces(fail = false) {
	const seen: Array<{ space: string; url: string; method: string; body: string }> = [];
	const namespace = {
		idFromName: (name: string) => name,
		get: (space: string) => ({
			fetch: async (request: Request) => {
				if (fail) throw new Error('No deployment found for branch "live"');
				seen.push({ space, url: request.url, method: request.method, body: await request.text() });
				return new Response('<h1>Northwind</h1>', { headers: { 'Content-Type': 'text/html' } });
			},
		}),
	};
	// The store has no language settings, so its pages are served as written.
	return { env: { SPACE_DO: namespace, DB: recordingD1().d1 } as unknown as Env, seen };
}

describe('a live store request', () => {
	it("goes to the store's SpaceDO on the live path, at the root, with its method, query and body", async () => {
		const { env, seen } = spaces();
		const response = await handleLiveStore(new Request('https://northwind-tea.estori.shop/products?page=2', { method: 'POST', body: 'q=tea' }), env, CTX, LIVE);
		expect(await response.text()).toBe('<h1>Northwind</h1>');
		expect(seen).toEqual([{ space: 'app_tea', url: 'https://northwind-tea.estori.shop/__live/products?page=2', method: 'POST', body: 'q=tea' }]);
	});

	it("answers Estori's own paths itself, however they're spelled, before the store's code", async () => {
		const { env, seen } = spaces();
		for (const path of ['/__estori/store.js', '/__ESTORI/store.js', '/%5F%5Festori/store.js']) {
			const response = await handleLiveStore(new Request(`https://northwind-tea.estori.shop${path}`), env, CTX, LIVE);
			expect(response.headers.get('Content-Type'), path).toContain('text/javascript');
		}
		expect(seen).toEqual([]);
	});

	it('shows a closed store as closed, without reaching its code', async () => {
		const { env, seen } = spaces();
		const response = await handleLiveStore(new Request('https://northwind-tea.estori.shop/'), env, CTX, { ...LIVE, store: { ...LIVE.store, status: 'offline' } });
		expect(response.status).toBe(404);
		expect(await response.text()).toContain("This store isn't open right now");
		expect(seen).toEqual([]);
	});

	it("keeps answering a paid shopper's receipts on a closed store, and nothing else of Estori's", async () => {
		const { env, seen } = spaces();
		const closed: StoreHost = { ...LIVE, store: { ...LIVE.store, status: 'offline' } };
		const receipt = await handleLiveStore(new Request('https://northwind-tea.estori.shop/__estori/orders/ord_abc'), { ...env, JWT_SECRET: 'live-store-test-secret-0123456789abcdef' } as Env, CTX, closed);
		expect(receipt.headers.get('Content-Type')).toContain('application/json');
		const checkout = await handleLiveStore(new Request('https://northwind-tea.estori.shop/__estori/store.js'), env, CTX, closed);
		expect(await checkout.text()).toContain("This store isn't open right now");
		expect(seen).toEqual([]);
	});

	it('answers a store that fails to load with a plain unavailable page', async () => {
		const { env } = spaces(true);
		const response = await handleLiveStore(new Request('https://northwind-tea.estori.shop/'), env, CTX, LIVE);
		expect(response.status).toBe(503);
		expect(await response.text()).toContain('temporarily unavailable');
	});
});
