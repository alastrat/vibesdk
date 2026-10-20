/** The billing endpoints on real SQL, with Stripe stood in by fetch. */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { envWith, insertPurchase, insertSubscription, insertUser, migratedD1 } from '../../../database/test-support/real-d1';
import { BillingController } from './controller';
import type { RouteContext } from '../../types/route-context';

let db: D1Database;
const PRICES = JSON.stringify({ pro: 'price_pro', premium: 'price_premium', credits: 'price_credits' });
const NOW = Date.now();

beforeAll(async () => {
	db = await migratedD1();
	for (const id of ['u_basic', 'u_paying', 'u_off']) await insertUser(db, id, { createdAt: new Date(NOW - 40 * 86_400_000) });
	await insertSubscription(db, { userId: 'u_paying', stripeSubscriptionId: 'sub_paying', status: 'active', plan: 'premium', currentPeriodStart: new Date(NOW - 86_400_000), currentPeriodEnd: new Date(NOW + 29 * 86_400_000) });
	await insertPurchase(db, { id: 'cp_1', userId: 'u_paying', credits: 5_000, purchasedAt: new Date(NOW - 86_400_000), expiresAt: new Date(NOW + 364 * 86_400_000) });
});

afterEach(() => vi.restoreAllMocks());

function env(extra: Record<string, unknown> = {}): Env {
	return envWith(db, { BILLING: 'on', STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_PRICE_IDS: PRICES, CUSTOM_DOMAIN: 'estori.app', VibecoderStore: { get: async () => null }, ...extra });
}

function context(userId: string): RouteContext {
	return { user: { id: userId, email: `${userId}@example.test` }, sessionId: 's1', pathParams: {}, queryParams: new URLSearchParams() } as unknown as RouteContext;
}

const post = (path: string, body: unknown = {}) => new Request(`https://estori.app${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('the billing endpoints', () => {
	it("shows a Basic account its month's credits", async () => {
		const response = await BillingController.get(new Request('https://estori.app/api/billing'), env(), {} as ExecutionContext, context('u_basic'));
		expect((await response.json()).data).toMatchObject({ enabled: true, plan: 'basic', source: 'free', status: null, credits: { pool: 5_000, used: 0, left: 5_000 }, alert: null, purchases: [], limits: { liveStores: 1 }, canManageBilling: false, canBuyCredits: false });
	});

	it('shows Premium its pool and purchases, and lets it buy more', async () => {
		const response = await BillingController.get(new Request('https://estori.app/api/billing'), env(), {} as ExecutionContext, context('u_paying'));
		expect((await response.json()).data).toMatchObject({ plan: 'premium', credits: { pool: 100_000, left: 105_000, purchasedLeft: 5_000 }, purchases: [{ credits: 5_000, left: 5_000 }], canBuyCredits: true });
	});

	it('shows an account outside the flag that plans are off, without its credits', async () => {
		const response = await BillingController.get(new Request('https://estori.app/api/billing'), env({ BILLING: undefined }), {} as ExecutionContext, context('u_paying'));
		expect((await response.json()).data).toMatchObject({ enabled: false, plan: 'basic', status: null, credits: null, alert: null, purchases: [], canManageBilling: false, canBuyCredits: false });
	});

	it('starts a checkout, keeping the Stripe customer it made, and refuses a second subscription', async () => {
		const stripe = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const path = new URL(String(input)).pathname;
			if (path === '/v1/customers') return Response.json({ id: 'cus_basic', email: null, metadata: null });
			if (path === '/v1/checkout/sessions') return Response.json({ id: 'cs_9', url: 'https://checkout.stripe.com/c/cs_9' });
			throw new Error(`unexpected ${path}`);
		});
		const response = await BillingController.checkout(post('/api/billing/checkout', { plan: 'pro' }), env(), {} as ExecutionContext, context('u_basic'));
		expect((await response.json()).data).toEqual({ url: 'https://checkout.stripe.com/c/cs_9', sessionId: 'cs_9' });
		expect(stripe).toHaveBeenCalledTimes(2);
		expect(await db.prepare("SELECT stripe_customer_id FROM billing_customers WHERE user_id = 'u_basic'").first()).toEqual({ stripe_customer_id: 'cus_basic' });
		expect((await BillingController.checkout(post('/api/billing/checkout', { plan: 'pro' }), env(), {} as ExecutionContext, context('u_paying'))).status).toBe(409);
	});

	it('answers 402 plan_limit when Basic tries to buy credits, and 403 when billing is off for the account', async () => {
		const refused = await BillingController.credits(post('/api/billing/credits', { credits: 5_000 }), env(), {} as ExecutionContext, context('u_basic'));
		expect(refused.status).toBe(402);
		expect((await refused.json()).error.planLimit).toMatchObject({ limit: 'extraCredits', upgradeTo: 'premium' });
		const off = await BillingController.checkout(post('/api/billing/checkout', { plan: 'pro' }), env({ BILLING: undefined, BILLING_USER_IDS: 'someone-else' }), {} as ExecutionContext, context('u_off'));
		expect(off.status).toBe(403);
		expect((await off.json()).error.message).toBe("Plans aren't open for your account yet.");
	});

	it('takes the bodiless actions without a body, and answers 401 without a session', async () => {
		const cancel = await BillingController.cancel(new Request('https://estori.app/api/billing/cancel', { method: 'POST' }), env(), {} as ExecutionContext, context('u_basic'));
		expect(cancel.status).toBe(404);
		const anonymous = { ...context('u_basic'), user: null } as RouteContext;
		expect((await BillingController.portal(new Request('https://estori.app/api/billing/portal', { method: 'POST' }), env(), {} as ExecutionContext, anonymous)).status).toBe(401);
	});
});
