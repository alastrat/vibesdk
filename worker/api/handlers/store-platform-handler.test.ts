import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleStorePlatform, type StorePlatformTarget } from './store-platform';
import { recordingD1 } from '../../database/test-support/recording-d1';
import { PUBLIC_PREVIEW_SUBJECT } from '../../utils/spacePreviewToken';

const BASE = 'https://preview.test/space/app_1/preview/main';
/** The request's execution context; work handed to waitUntil is dropped in these tests. */
const CTX = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;

const TARGET: StorePlatformTarget = {
	appId: 'app_1',
	branch: 'main',
	basePath: '/space/app_1/preview/main',
	platformPath: '/__estori/checkout',
	viewer: { kind: 'preview', userId: PUBLIC_PREVIEW_SUBJECT },
};

function testEnv(overrides: Record<string, unknown> = {}) {
	const { d1, statements } = recordingD1();
	return { env: { DB: d1, JWT_SECRET: 'store-platform-test-secret-0123456789ab', ...overrides } as unknown as Env, statements };
}

function checkoutRequest(init: { origin?: string; contentType?: string; body?: string } = {}): Request {
	return new Request(`${BASE}/__estori/checkout`, {
		method: 'POST',
		headers: { Origin: init.origin ?? 'https://preview.test', 'Content-Type': init.contentType ?? 'application/json' },
		body: init.body ?? JSON.stringify({ items: [{ variantId: 'trail-mug-blue', quantity: 1 }], shipTo: 'US' }),
	});
}

describe('handleStorePlatform', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('serves the store script', async () => {
		const response = await handleStorePlatform(new Request(`${BASE}/__estori/store.js`), testEnv().env, { ...TARGET, platformPath: '/__estori/store.js' }, CTX);
		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toContain('text/javascript');
	});

	it("serves Estori's checkout page on the store's address, with its own security policy and a fresh nonce each time", async () => {
		const env = testEnv({ STRIPE_PUBLISHABLE_KEY: 'pk_test_123', CUSTOM_DOMAIN: 'build.estori.test' }).env;
		const target = { ...TARGET, platformPath: '/__estori/pay' };
		const first = await handleStorePlatform(new Request(`${BASE}/__estori/pay?success=%2Fthanks`), env, target, CTX);
		expect(first.status).toBe(200);
		expect(first.headers.get('Content-Type')).toContain('text/html');
		const policy = first.headers.get('Content-Security-Policy') ?? '';
		expect(policy).toContain("frame-ancestors 'self' https://build.estori.test");
		const html = await first.text();
		expect(html).toContain('"publishableKey":"pk_test_123"');
		const second = await handleStorePlatform(new Request(`${BASE}/__estori/pay`), env, target, CTX);
		expect(second.headers.get('Content-Security-Policy')).not.toBe(policy);
	});

	it("checks the checkout page's return paths on the server, so a crafted link can't send the shopper off the store", async () => {
		const env = testEnv({ STRIPE_PUBLISHABLE_KEY: 'pk_test_123' }).env;
		const target = { ...TARGET, platformPath: '/__estori/pay' };
		const config = async (query: string) => {
			const html = await (await handleStorePlatform(new Request(`${BASE}/__estori/pay${query}`), env, target, CTX)).text();
			return JSON.parse(html.match(/<script type="application\/json" id="estori-pay-config">([\s\S]*?)<\/script>/)?.[1] ?? '{}');
		};
		expect(await config('?success=%2Fthanks&cancel=%2Fcart')).toMatchObject({ successPath: '/thanks', cancelPath: '/cart' });
		expect(await config('?success=%2F%2Fevil.example&cancel=%2F%09%2Fevil.example')).toMatchObject({ successPath: '/', cancelPath: '/' });
	});

	it("lets a live store's shopper past the demo refusal, since the store is open to anyone", async () => {
		const live = { ...TARGET, branch: 'live', basePath: '', viewer: { kind: 'live' as const, sellerUserId: 'seller_1' } };
		const request = new Request('https://northwind-tea.estori.shop/__estori/checkout', {
			method: 'POST',
			headers: { Origin: 'https://northwind-tea.estori.shop', 'Content-Type': 'application/json' },
			body: JSON.stringify({ items: [{ variantId: 'trail-mug-blue', quantity: 1 }], shipTo: 'US' }),
		});
		const response = await handleStorePlatform(request, testEnv({ STRIPE_SECRET_KEY: 'sk_test_live_store' }).env, live, CTX);
		// The test seller has no payments set up here, so it stops there, and not at "This is a demo".
		expect(await response.json()).toMatchObject({ ok: false, reason: 'payments_unavailable' });
	});

	it('refuses checkouts from another origin, of another type or too large, before reading anything', async () => {
		const { env, statements } = testEnv();
		expect((await handleStorePlatform(checkoutRequest({ origin: 'https://evil.example' }), env, TARGET, CTX)).status).toBe(400);
		expect((await handleStorePlatform(checkoutRequest({ contentType: 'text/plain' }), env, TARGET, CTX)).status).toBe(400);
		expect((await handleStorePlatform(checkoutRequest({ body: JSON.stringify({ note: 'x'.repeat(17 * 1024) }) }), env, TARGET, CTX)).status).toBe(413);
		expect(statements).toHaveLength(0);
	});

	it('answers a demo for public previews', async () => {
		const response = await handleStorePlatform(checkoutRequest(), testEnv().env, TARGET, CTX);
		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({ ok: false, reason: 'demo_only' });
	});

	it('shows a receipt only to the browser holding it, and answers unknown paths itself', async () => {
		const receipt = await handleStorePlatform(new Request(`${BASE}/__estori/orders/ord_abc`), testEnv().env, { ...TARGET, platformPath: '/__estori/orders/ord_abc' }, CTX);
		expect(receipt.status).toBe(404);
		const unknown = await handleStorePlatform(new Request(`${BASE}/__estori/admin`), testEnv().env, { ...TARGET, platformPath: '/__estori/admin' }, CTX);
		expect(unknown.status).toBe(404);
	});

	it('sends a returning shopper back to the store when the payment cannot be read yet', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Stripe is unreachable'));
		const request = new Request(`${BASE}/__estori/return?session_id=cs_1`);
		const response = await handleStorePlatform(request, testEnv({ STRIPE_SECRET_KEY: 'sk_test_fake' }).env, { ...TARGET, platformPath: '/__estori/return' }, CTX);
		expect(response.status).toBe(303);
		expect(response.headers.get('Location')).toBe(`${BASE}/?status=processing`);
	});
});
