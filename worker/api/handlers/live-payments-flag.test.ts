import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorePlatformTarget } from './store-platform';
import { recordingD1 } from '../../database/test-support/recording-d1';
import { PUBLIC_PREVIEW_SUBJECT } from '../../utils/spacePreviewToken';

const { isFlagOn } = vi.hoisted(() => ({ isFlagOn: vi.fn(async () => false) }));
vi.mock('../../services/posthog/flags', () => ({ isFlagOn }));

const { handleStorePlatform } = await import('./store-platform');

const sources = import.meta.glob<string>(['/worker/api/handlers/store-platform.ts'], { query: '?raw', import: 'default', eager: true });
const platform = sources['/worker/api/handlers/store-platform.ts'] ?? '';

describe('real payments on live stores', () => {
	it('need a live store, Stripe in live mode, LIVE_STORE_PAYMENTS on and the pause flag off, checked for the seller', () => {
		expect(platform).toContain("if (access !== 'live' || stripeModeOf(env) !== 'live' || env.LIVE_STORE_PAYMENTS !== 'on') return false;");
		expect(platform).toContain("return !(await isFlagOn(env, 'live-store-payments-paused', sellerUserId));");
	});

	it('are checked the same way for the store info, the pay page and checkout itself', () => {
		expect(platform.match(/livePayments: await livePaymentsOn\(env, access, sellerIdOf\(target\)\)/g)).toHaveLength(2);
		expect(platform.match(/livePayments:/g)).toHaveLength(2);
	});

	it("lock catalog prices for the store's seller", () => {
		expect(platform).toContain('lockCatalogPricesFor(env, ids, country, sellerIdOf(target))');
	});
});

const CTX = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
const PREVIEW = 'https://preview.test/space/app_1/preview/main';
const PAY_PAGE: StorePlatformTarget = { appId: 'app_1', branch: 'main', basePath: '/space/app_1/preview/main', platformPath: '/__estori/pay', viewer: { kind: 'preview', userId: PUBLIC_PREVIEW_SUBJECT } };
const OWNER_PAY_PAGE: StorePlatformTarget = { ...PAY_PAGE, viewer: { kind: 'preview', userId: 'seller_1' } };
const LIVE_PAY_PAGE: StorePlatformTarget = { ...PAY_PAGE, branch: 'live', basePath: '', viewer: { kind: 'live', sellerUserId: 'seller_1' } };

/** Live payments switched on with a live Stripe key; the app belongs to seller_1. */
function liveMoneyEnv(overrides: Record<string, unknown> = {}): Env {
	const { d1 } = recordingD1((sql) => (sql.includes('from "apps"') ? [['app_1', 'seller_1', 'private']] : []));
	return { DB: d1, JWT_SECRET: 'store-platform-test-secret-0123456789ab', STRIPE_SECRET_KEY: 'sk_live_platform', LIVE_STORE_PAYMENTS: 'on', ...overrides } as unknown as Env;
}

async function openPayPage(env: Env, target: StorePlatformTarget): Promise<void> {
	const url = target.viewer.kind === 'live' ? 'https://northwind-tea.estori.shop/__estori/pay' : `${PREVIEW}/__estori/pay`;
	expect((await handleStorePlatform(new Request(url), env, target, CTX)).status).toBe(200);
}

describe('the live payments pause flag', () => {
	beforeEach(() => {
		isFlagOn.mockClear();
	});

	it("is read for a live store's shopper when the platform takes real money, for the store's seller", async () => {
		const env = liveMoneyEnv();
		await openPayPage(env, LIVE_PAY_PAGE);
		expect(isFlagOn).toHaveBeenCalledExactlyOnceWith(env, 'live-store-payments-paused', 'seller_1');
	});

	it("is never read for a preview, the owner's or anyone else's, whose payments are never real", async () => {
		await openPayPage(liveMoneyEnv(), PAY_PAGE);
		await openPayPage(liveMoneyEnv(), OWNER_PAY_PAGE);
		const checkout = new Request(`${PREVIEW}/__estori/checkout`, {
			method: 'POST',
			headers: { Origin: 'https://preview.test', 'Content-Type': 'application/json' },
			body: JSON.stringify({ items: [{ variantId: 'trail-mug-blue', quantity: 1 }], shipTo: 'US' }),
		});
		expect(await (await handleStorePlatform(checkout, liveMoneyEnv(), { ...PAY_PAGE, platformPath: '/__estori/checkout' }, CTX)).json()).toMatchObject({ reason: 'demo_only' });
		expect(isFlagOn).not.toHaveBeenCalled();
	});

	it('is never read while Stripe is in test mode or live payments are switched off', async () => {
		await openPayPage(liveMoneyEnv({ STRIPE_SECRET_KEY: 'sk_test_platform' }), LIVE_PAY_PAGE);
		await openPayPage(liveMoneyEnv({ LIVE_STORE_PAYMENTS: undefined }), LIVE_PAY_PAGE);
		expect(isFlagOn).not.toHaveBeenCalled();
	});
});
