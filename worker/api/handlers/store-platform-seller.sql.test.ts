/**
 * The seller gate behind a live store's checkout, on real SQL: a checkout reads the seller's account from Stripe, so a
 * stored "ready" never lets payments through once Stripe says otherwise, and stale stored flags are rewritten. Each
 * test's writes are rolled back after it.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { envWith, insertApp, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { handleStorePlatform, type StorePlatformTarget } from './store-platform';
import { SELLER_TERMS_VERSION } from '../../../shared/types/seller-setup';

const CTX = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
const LIVE: StorePlatformTarget = { appId: 'app_tea', branch: 'live', basePath: '', platformPath: '/__estori/checkout', viewer: { kind: 'live', sellerUserId: 'seller_1' } };
let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'seller_1');
	await insertApp(db, { id: 'app_tea', userId: 'seller_1', title: 'Northwind Tea' });
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** The seller as Estori stored them: terms accepted and every Stripe flag ready, last refreshed `minutesAgo`. */
async function readySeller(minutesAgo: number): Promise<void> {
	await db.prepare('UPDATE users SET seller_terms_version = ? WHERE id = ?').bind(SELLER_TERMS_VERSION, 'seller_1').run();
	await db.prepare("INSERT INTO live_stores (app_id, slug, status, published_commit, published_at, created_at, updated_at) VALUES ('app_tea', 'northwind-tea', 'live', 'c0ffee1', 0, 0, 0)").run();
	await db
		.prepare(
			"INSERT INTO stripe_connect_accounts (user_id, stripe_account_id, details_submitted, charges_enabled, payouts_enabled, transfers_active, card_payments_active, created_at, updated_at) VALUES ('seller_1', 'acct_tea', 1, 1, 1, 1, 1, ?, ?)",
		)
		.bind(Math.floor(Date.now() / 1000) - minutesAgo * 60, Math.floor(Date.now() / 1000) - minutesAgo * 60)
		.run();
}

/** Stripe answering the account read: payouts switched off since Estori last looked. */
function stripeSaysPayoutsOff(): string[] {
	const asked: string[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
		const url = String(input instanceof Request ? input.url : input);
		asked.push(url);
		if (url.startsWith('https://api.stripe.com/v1/accounts/acct_tea')) {
			return Response.json({ id: 'acct_tea', details_submitted: true, charges_enabled: true, payouts_enabled: false, capabilities: { card_payments: 'active', transfers: 'active' } });
		}
		throw new Error(`unexpected fetch ${url}`);
	});
	return asked;
}

function checkout(): Request {
	return new Request('https://northwind-tea.estori.shop/__estori/checkout', {
		method: 'POST',
		headers: { Origin: 'https://northwind-tea.estori.shop', 'Content-Type': 'application/json' },
		body: JSON.stringify({ items: [{ variantId: 'oolong-100', quantity: 1 }], shipTo: 'US' }),
	});
}

describe("a live store's checkout and its seller's Stripe account", () => {
	it('refuses payments when Stripe says the seller can no longer take them, whatever Estori stored, and rewrites the stale flags', async () => {
		await readySeller(20);
		const asked = stripeSaysPayoutsOff();
		const response = await handleStorePlatform(checkout(), envWith(db, { STRIPE_SECRET_KEY: 'sk_test_gate', JWT_SECRET: 'store-platform-seller-test-secret-0123' }), LIVE, CTX);
		expect(await response.json()).toMatchObject({ ok: false, reason: 'payments_unavailable' });
		expect(asked.some((url) => url.startsWith('https://api.stripe.com/v1/accounts/acct_tea'))).toBe(true);
		expect(await db.prepare("SELECT payouts_enabled FROM stripe_connect_accounts WHERE user_id = 'seller_1'").first()).toEqual({ payouts_enabled: 0 });
	});

	it('still reads Stripe for flags stored moments ago, but leaves those flags as they are', async () => {
		await readySeller(1);
		stripeSaysPayoutsOff();
		const response = await handleStorePlatform(checkout(), envWith(db, { STRIPE_SECRET_KEY: 'sk_test_gate', JWT_SECRET: 'store-platform-seller-test-secret-0123' }), LIVE, CTX);
		expect(await response.json()).toMatchObject({ ok: false, reason: 'payments_unavailable' });
		expect(await db.prepare("SELECT payouts_enabled FROM stripe_connect_accounts WHERE user_id = 'seller_1'").first()).toEqual({ payouts_enabled: 1 });
	});
});
