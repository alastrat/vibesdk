/**
 * A seller's return from the checkout page on real SQL: the status answer records a paid checkout the way the webhook
 * does, Stripe's API stood in by fetch serving each object's latest copy, Estori's emails and PostHog's events captured.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { envWith, insertBillingCustomer, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import type { StripeCheckoutSession, StripeSubscription } from '../payments/stripe-client';
import type { StripeEvent } from '../payments/webhook';

const captured = vi.hoisted((): Array<[string, string, unknown]> => []);
vi.mock('../posthog/analytics', () => ({
	serverAnalytics: () => ({ capture: (name: string, userId: string, properties: unknown) => captured.push([name, userId, properties]) }),
}));

const { billingActionDepsFromEnv, checkoutStatus } = await import('./actions');
const { handleBillingEvent } = await import('./events');
const { billingEventDepsFromEnv } = await import('./wiring');

const PRICES = { pro: 'price_pro', premium: 'price_premium', credits: 'price_credits' };
const START = Date.parse('2026-10-05T10:00:00Z') / 1000;
const END = Date.parse('2026-11-05T10:00:00Z') / 1000;
const STATUS = new Request('https://estori.app/api/billing/checkout/status?session_id=cs_x');

let db: D1Database;
const sent: string[] = [];

beforeAll(async () => {
	db = await migratedD1();
});

afterEach(() => {
	vi.restoreAllMocks();
	sent.length = 0;
	captured.length = 0;
});

function env(): Env {
	return envWith(db, {
		STRIPE_SECRET_KEY: 'sk_test_fake',
		STRIPE_PUBLISHABLE_KEY: 'pk_test_fake',
		STRIPE_PRICE_IDS: JSON.stringify(PRICES),
		CUSTOM_DOMAIN: 'estori.app',
		ENVIRONMENT: 'prod',
		EMAIL: {
			send: async (message: { subject: string }) => {
				sent.push(message.subject);
				return { messageId: 'm1' };
			},
		},
		VibecoderStore: { get: async () => null, put: async () => undefined },
	});
}

/** Stripe's API: the latest copy of each object by id. */
function stripeServes(objects: Record<string, unknown>): void {
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
		const id = new URL(String(input)).pathname.split('/').pop() ?? '';
		const object = objects[id];
		return object ? Response.json(object) : Response.json({ error: { message: `No such object: ${id}` } }, { status: 404 });
	});
}

async function seller(userId: string): Promise<string> {
	await insertUser(db, userId);
	await insertBillingCustomer(db, userId, `cus_${userId}`);
	return `cus_${userId}`;
}

function subscription(userId: string, customer: string): StripeSubscription {
	return {
		id: `sub_${userId}`,
		customer,
		status: 'active',
		created: START,
		cancel_at_period_end: false,
		cancel_at: null,
		metadata: { estori_user_id: userId },
		items: { data: [{ id: 'si_1', price: { id: 'price_pro', metadata: null }, current_period_start: START, current_period_end: END }] },
		schedule: null,
	};
}

/** A subscription checkout the seller has paid, as Stripe reads it back. */
function paidPlan(userId: string, customer: string, overrides: Partial<StripeCheckoutSession> = {}): StripeCheckoutSession {
	return {
		id: `cs_${userId}`,
		mode: 'subscription',
		url: null,
		subscription: `sub_${userId}`,
		customer,
		client_reference_id: userId,
		payment_status: 'paid',
		status: 'complete',
		metadata: { estori_user_id: userId, plan: 'pro' },
		amount_total: 4_900,
		currency: 'usd',
		payment_intent: null,
		discounts: null,
		...overrides,
	};
}

function paidCredits(userId: string, customer: string): StripeCheckoutSession {
	return {
		id: `cs_${userId}`,
		mode: 'payment',
		url: null,
		customer,
		client_reference_id: userId,
		payment_status: 'paid',
		status: 'complete',
		metadata: { kind: 'credits', estori_user_id: userId, credits: '12000' },
		amount_total: 1_800,
		currency: 'usd',
		payment_intent: `pi_${userId}`,
	};
}

/** The webhook's copy of a completed checkout: Stripe sends the session as it is at that moment. */
function completed(eventId: string, session: StripeCheckoutSession): StripeEvent {
	return { id: eventId, type: 'checkout.session.completed', data: { object: session } };
}

const subscriptionRows = (userId: string) => db.prepare('SELECT stripe_subscription_id AS id, status, plan FROM subscriptions WHERE user_id = ?').bind(userId).all();
const purchaseCount = (userId: string) => db.prepare('SELECT COUNT(*) AS n FROM credit_purchases WHERE user_id = ?').bind(userId).first('n');
const eventIds = (objectId: string) => db.prepare('SELECT stripe_event_id AS id, result FROM billing_events WHERE object_id = ? ORDER BY stripe_event_id').bind(objectId).all();
const status = (userId: string, sessionId: string) => checkoutStatus(billingActionDepsFromEnv(env(), STATUS), userId, sessionId);

describe('the status of a paid checkout', () => {
	it('a paid plan session records the subscription once', async () => {
		const customer = await seller('u_paid');
		stripeServes({ cs_u_paid: paidPlan('u_paid', customer), sub_u_paid: subscription('u_paid', customer) });
		const answer = { ok: true, value: { state: 'paid', kind: 'plan' } };
		expect(await status('u_paid', 'cs_u_paid')).toEqual(answer);
		expect(await status('u_paid', 'cs_u_paid')).toEqual(answer);
		expect((await subscriptionRows('u_paid')).results).toEqual([{ id: 'sub_u_paid', status: 'active', plan: 'pro' }]);
		expect((await eventIds('sub_u_paid')).results).toEqual([{ id: 'return:cs_u_paid', result: 'applied' }]);
		expect(captured).toEqual([['subscription_started', 'u_paid', { plan: 'pro' }]]);
		expect(sent).toEqual(['Welcome to Estori Pro']);
	});

	it('a paid credits session records the purchase once', async () => {
		const customer = await seller('u_credits');
		stripeServes({ cs_u_credits: paidCredits('u_credits', customer) });
		expect(await status('u_credits', 'cs_u_credits')).toEqual({ ok: true, value: { state: 'paid', kind: 'credits' } });
		expect(await status('u_credits', 'cs_u_credits')).toMatchObject({ ok: true });
		expect(await purchaseCount('u_credits')).toBe(1);
		expect(captured).toEqual([['credits_purchased', 'u_credits', { credits: 12_000, amount_cents: 1_800 }]]);
		expect(sent).toEqual(['Your Estori receipt: 12,000 AI credits']);
	});

	it('status and webhook together record one purchase and one subscription event', async () => {
		const subscriber = await seller('u_both_plan');
		const buyer = await seller('u_both_credits');
		const plan = paidPlan('u_both_plan', subscriber);
		const credits = paidCredits('u_both_credits', buyer);
		stripeServes({ cs_u_both_plan: plan, sub_u_both_plan: subscription('u_both_plan', subscriber), cs_u_both_credits: credits });

		await status('u_both_plan', 'cs_u_both_plan');
		await status('u_both_credits', 'cs_u_both_credits');
		const webhook = billingEventDepsFromEnv(env());
		await handleBillingEvent(webhook, completed('evt_both_plan', plan));
		await handleBillingEvent(webhook, completed('evt_both_credits', credits));
		// Stripe delivers the same events again.
		await handleBillingEvent(webhook, completed('evt_both_plan', plan));
		await handleBillingEvent(webhook, completed('evt_both_credits', credits));

		expect(await purchaseCount('u_both_credits')).toBe(1);
		expect((await subscriptionRows('u_both_plan')).results).toHaveLength(1);
		expect(captured.filter(([name]) => name === 'subscription_started')).toEqual([['subscription_started', 'u_both_plan', { plan: 'pro' }]]);
		expect(captured.filter(([name]) => name === 'credits_purchased')).toHaveLength(1);
		expect(sent.sort()).toEqual(['Welcome to Estori Pro', 'Your Estori receipt: 12,000 AI credits']);
	});

	it('records one subscription and one event when the return and the webhook run at once', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const customer = await seller('u_race_plan');
		const plan = paidPlan('u_race_plan', customer);
		stripeServes({ cs_u_race_plan: plan, sub_u_race_plan: subscription('u_race_plan', customer) });
		const webhook = billingEventDepsFromEnv(env());
		const [answer] = await Promise.all([status('u_race_plan', 'cs_u_race_plan'), handleBillingEvent(webhook, completed('evt_race_plan', plan))]);
		expect(answer).toEqual({ ok: true, value: { state: 'paid', kind: 'plan' } });
		expect((await subscriptionRows('u_race_plan')).results).toEqual([{ id: 'sub_u_race_plan', status: 'active', plan: 'pro' }]);
		expect(captured).toEqual([['subscription_started', 'u_race_plan', { plan: 'pro' }]]);
		expect(sent).toEqual(['Welcome to Estori Pro']);
	});

	it('records one purchase and one event when the return and the webhook run at once', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const customer = await seller('u_race_credits');
		const credits = paidCredits('u_race_credits', customer);
		stripeServes({ cs_u_race_credits: credits });
		const webhook = billingEventDepsFromEnv(env());
		const [answer] = await Promise.all([status('u_race_credits', 'cs_u_race_credits'), handleBillingEvent(webhook, completed('evt_race_credits', credits))]);
		expect(answer).toEqual({ ok: true, value: { state: 'paid', kind: 'credits' } });
		expect(await purchaseCount('u_race_credits')).toBe(1);
		expect(captured).toEqual([['credits_purchased', 'u_race_credits', { credits: 12_000, amount_cents: 1_800 }]]);
		expect(sent).toEqual(['Your Estori receipt: 12,000 AI credits']);
	});

	it('records one purchase and one subscription event when the webhook comes first', async () => {
		const subscriber = await seller('u_first_plan');
		const buyer = await seller('u_first_credits');
		const plan = paidPlan('u_first_plan', subscriber);
		const credits = paidCredits('u_first_credits', buyer);
		stripeServes({ cs_u_first_plan: plan, sub_u_first_plan: subscription('u_first_plan', subscriber), cs_u_first_credits: credits });

		const webhook = billingEventDepsFromEnv(env());
		await handleBillingEvent(webhook, completed('evt_first_plan', plan));
		await handleBillingEvent(webhook, completed('evt_first_credits', credits));
		await status('u_first_plan', 'cs_u_first_plan');
		await status('u_first_credits', 'cs_u_first_credits');

		expect(await purchaseCount('u_first_credits')).toBe(1);
		expect((await subscriptionRows('u_first_plan')).results).toHaveLength(1);
		expect(captured.filter(([name]) => name === 'subscription_started')).toHaveLength(1);
		expect(captured.filter(([name]) => name === 'credits_purchased')).toHaveLength(1);
		expect(sent.sort()).toEqual(['Welcome to Estori Pro', 'Your Estori receipt: 12,000 AI credits']);
	});
});

describe('the status of a checkout that is not paid, or not the seller', () => {
	it("status for another seller's session answers 404, recording nothing for either", async () => {
		const owner = await seller('u_owner');
		await seller('u_other');
		stripeServes({ cs_u_owner: paidPlan('u_owner', owner), sub_u_owner: subscription('u_owner', owner) });
		expect(await status('u_other', 'cs_u_owner')).toEqual({ ok: false, status: 404, message: "We couldn't find that checkout." });
		expect((await subscriptionRows('u_owner')).results).toEqual([]);
		expect((await subscriptionRows('u_other')).results).toEqual([]);
		expect(captured).toEqual([]);
	});

	it('status of an expired session answers expired, recording nothing', async () => {
		const customer = await seller('u_expired');
		stripeServes({ cs_u_expired: paidPlan('u_expired', customer, { status: 'expired', payment_status: 'unpaid' }) });
		expect(await status('u_expired', 'cs_u_expired')).toEqual({ ok: true, value: { state: 'expired', kind: 'plan' } });
		expect((await subscriptionRows('u_expired')).results).toEqual([]);
		expect((await eventIds('sub_u_expired')).results).toEqual([]);
		expect(captured).toEqual([]);
	});

	it('answers the state when the return cannot record, because the webhook records it', async () => {
		const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const customer = await seller('u_unrecorded');
		// Stripe has the session but not the subscription it names, so the return's own read fails.
		stripeServes({ cs_u_unrecorded: paidPlan('u_unrecorded', customer) });
		expect(await status('u_unrecorded', 'cs_u_unrecorded')).toEqual({ ok: true, value: { state: 'paid', kind: 'plan' } });
		expect((await subscriptionRows('u_unrecorded')).results).toEqual([]);
		expect(warnings).toHaveBeenCalledTimes(1);
	});
});
