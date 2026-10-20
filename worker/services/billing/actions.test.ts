import { afterEach, describe, expect, it, vi } from 'vitest';
import { BILLING_CHECKOUT_EXPAND, StripeApiError, type StripeCheckoutSession, type StripeCoupon, type StripeSubscription } from '../payments/stripe-client';
import { STRIPE_REQUEST_FAILED_MESSAGE } from '../payments/config';
import { BILLING_MESSAGES, buyCredits, cancelPlan, changePlan, checkoutStatus, checkoutTerms, openPortal, recordCheckoutConsent, resumePlan, startCheckout, type BillingActionDeps } from './actions';
import type { BillingConsentInput } from '../../database/services/BillingService';
import type { CreditPurchaseRecord, SubscriptionRecord } from '../../database/schema';
import type { BillingAccount } from './account';
import { PLAN_LIMITS } from '../../../shared/types/plans';
import { BILLING_CHECKOUT_PAUSED_MESSAGE } from '../../../shared/types/pauses';
import { CHECKOUT_EXPIRED_MESSAGE, PAYMENTS_NOT_SET_UP_MESSAGE } from '../../../shared/types/billing';
import { TERMS_OUTDATED_MESSAGE, TERMS_VERSION } from '../../../shared/types/legal';

const USER = { id: 'u1', email: 'ana@example.test' };

afterEach(() => vi.restoreAllMocks());

/** Silences the warnings the deliberate Stripe failures log; the spy counts them. */
function quietWarnings() {
	return vi.spyOn(console, 'warn').mockImplementation(() => undefined);
}

function row(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
	return {
		userId: 'u1',
		stripeSubscriptionId: 'sub_1',
		status: 'active',
		plan: 'pro',
		currentPeriodStart: new Date('2026-10-05T10:00:00Z'),
		currentPeriodEnd: new Date('2026-11-05T10:00:00Z'),
		cancelAtPeriodEnd: false,
		pendingPlan: null,
		pendingPlanAt: null,
		stripeScheduleId: null,
		stripeCreatedAt: new Date('2026-10-05T10:00:00Z'),
		updatedAt: new Date('2026-10-05T10:00:00Z'),
		...overrides,
	};
}

function account(plan: 'basic' | 'pro' | 'premium'): BillingAccount {
	const period = { key: 'sub:sub_1:1', startMs: 0, endMs: 1 };
	return { billing: true, userId: 'u1', plan, limits: PLAN_LIMITS[plan], creditsResetAt: 1, source: 'subscription', period, graceEndsAtMs: null, subscription: null };
}

const SUBSCRIPTION: StripeSubscription = { id: 'sub_1', customer: 'cus_1', status: 'active', created: 1, cancel_at_period_end: true, cancel_at: null, metadata: { estori_user_id: 'u1' }, items: { data: [{ id: 'si_1', price: { id: 'price_pro' }, current_period_start: 1, current_period_end: 2 }] }, schedule: null };
function purchase(id: string): CreditPurchaseRecord {
	const at = new Date('2026-10-19T14:00:00Z');
	return { id, userId: 'u1', credits: 12_000, amountCents: 1_800, stripeCheckoutSessionId: `cs_${id}`, stripePaymentIntentId: `pi_${id}`, purchasedAt: at, expiresAt: new Date('2027-10-19T14:00:00Z'), used: 0, refundedCents: 0, removedCredits: 0, expiredAt: null };
}

/** What Stripe answers when a checkout is made: an Elements session, with no hosted page. */
const SESSION: StripeCheckoutSession = { id: 'cs_1', url: null, client_secret: 'cs_1_secret_x', payment_status: 'unpaid', status: 'open', client_reference_id: 'u1', metadata: null, amount_total: null, currency: 'usd', payment_intent: null };

const NO_CODE_CONSENT = 'I agree to the Terms, and that Estori Pro renews at $49 a month until I cancel.';

/** A subscription checkout the seller has open, as Stripe returns it read back with its discounts. */
const PLAN_SESSION: StripeCheckoutSession = {
	id: 'cs_plan',
	mode: 'subscription',
	url: null,
	client_secret: 'cs_plan_secret_x',
	subscription: 'sub_9',
	customer: 'cus_1',
	payment_status: 'unpaid',
	status: 'open',
	client_reference_id: 'u1',
	metadata: { estori_user_id: 'u1', plan: 'pro' },
	amount_total: 4_900,
	currency: 'usd',
	payment_intent: null,
	discounts: null,
};

const CREDITS_SESSION: StripeCheckoutSession = {
	...PLAN_SESSION,
	id: 'cs_credits',
	mode: 'payment',
	subscription: null,
	metadata: { kind: 'credits', estori_user_id: 'u1', credits: '12000' },
	amount_total: 1_800,
	payment_intent: 'pi_1',
};

const coupon = (overrides: Partial<StripeCoupon> = {}): StripeCoupon => ({ id: 'half', duration: 'once', duration_in_months: null, ...overrides });

/** The plan session with a promotion code applied: half off the first payment unless the coupon says otherwise. */
const withCode = (overrides: Partial<StripeCoupon> = {}, session: StripeCheckoutSession = PLAN_SESSION): StripeCheckoutSession => ({
	...session,
	amount_total: 2_450,
	discounts: [{ promotion_code: { id: 'promo_1', promotion: { type: 'coupon', coupon: coupon(overrides) } } }],
});

/**
 * `schedule` is a schedule Stripe has on the subscription, which a release drops unless it is `stuck`; `price` is the
 * price Stripe has it on; `card` is the subscription's own default payment method (null: the customer's, `customerCard`).
 */
function fake(
	state: {
		row?: SubscriptionRecord | null;
		customer?: string | null;
		failWith?: Error;
		schedule?: string | null;
		stuck?: boolean;
		price?: string;
		card?: string | null;
		customerCard?: string | null;
		purchases?: CreditPurchaseRecord[];
		paused?: boolean;
		/** The sessions Stripe has, by id; any other id is unknown to it. */
		sessions?: StripeCheckoutSession[];
		/** `null` is a deployment without Stripe's publishable key. */
		publishableKey?: string | null;
		recordFails?: boolean;
	} = {},
) {
	const calls: string[] = [];
	const keys: string[] = [];
	const expands: Array<readonly string[] | undefined> = [];
	const consents: BillingConsentInput[] = [];
	const recorded: string[] = [];
	const deps: BillingActionDeps = {
		stripe: {
			createCustomer: async ({ userId }) => {
				calls.push(`customer:${userId}`);
				return { id: 'cus_new', email: null, metadata: null };
			},
			retrieveCustomer: async (id) => {
				calls.push(`read-customer:${id}`);
				return { id, email: null, metadata: null, invoice_settings: { default_payment_method: state.customerCard ?? null } };
			},
			createSubscriptionCheckoutSession: async (input) => {
				calls.push(`checkout:${input.customerId}:${input.priceId}`);
				return SESSION;
			},
			createCreditsCheckoutSession: async (input) => {
				calls.push(`credits:${input.customerId}:${input.credits}`);
				keys.push(input.idempotencyKey);
				return SESSION;
			},
			retrieveSubscription: async (id) => {
				calls.push(`read:${id}`);
				const schedule = state.schedule ? { id: state.schedule, status: 'active', subscription: id, current_phase: null, phases: [] } : null;
				const item = { ...SUBSCRIPTION.items.data[0], price: { id: state.price ?? 'price_pro' } };
				const card = state.card === undefined ? 'pm_1' : state.card;
				return { ...SUBSCRIPTION, schedule, items: { data: [item] }, default_payment_method: card };
			},
			changeSubscriptionPrice: async ({ priceId, idempotencyKey }) => {
				keys.push(idempotencyKey);
				if (state.failWith) throw state.failWith;
				calls.push(`now:${priceId}`);
				return SUBSCRIPTION;
			},
			scheduleSubscriptionPrice: async ({ priceId }) => {
				calls.push(`renewal:${priceId}`);
				return { id: 'sub_sched_1', status: 'active', subscription: 'sub_1', current_phase: null, phases: [] };
			},
			releaseSubscriptionSchedule: async (id) => {
				calls.push(`release:${id}`);
				if (!state.stuck && state.schedule === id) state.schedule = null;
			},
			cancelAtPeriodEnd: async (id) => {
				// Stripe refuses to end a subscription a schedule still manages.
				if (state.schedule) throw new StripeApiError(`The subscription is managed by the subscription schedule \`${state.schedule}\``, 400, null, 'invalid_request_error');
				calls.push(`cancel:${id}`);
				return SUBSCRIPTION;
			},
			resumeSubscription: async (subscription) => {
				calls.push(`resume:${subscription.id}`);
				return subscription;
			},
			createBillingPortalSession: async ({ customerId }) => {
				calls.push(`portal:${customerId}`);
				return { url: 'https://billing.stripe.com/p/1' };
			},
			retrieveCheckoutSession: async (id, expand) => {
				calls.push(`session:${id}`);
				expands.push(expand);
				const found = state.sessions?.find((session) => session.id === id);
				if (!found) throw new StripeApiError(`No such checkout.session: '${id}'`, 404, 'resource_missing', 'invalid_request_error');
				return found;
			},
		},
		store: {
			customerOf: async () => state.customer ?? null,
			saveCustomer: async (_userId, id) => {
				state.customer = id;
				calls.push(`saved:${id}`);
				return id;
			},
			subscriptionOf: async () => state.row ?? null,
		},
		ledger: { purchasesOf: async () => state.purchases ?? [] },
		priceIds: { pro: 'price_pro', premium: 'price_premium', credits: 'price_credits' },
		publishableKey: state.publishableKey === undefined ? 'pk_test_1' : state.publishableKey,
		consents: {
			recordConsent: async (input) => void consents.push(input),
			consentFor: async () => null,
		},
		record: {
			subscription: async (sessionId, subscriptionId, userId) => {
				if (state.recordFails) throw new Error('D1_ERROR: network connection lost');
				recorded.push(`subscription:${sessionId}:${subscriptionId}:${userId}`);
			},
			credits: async (sessionId) => {
				if (state.recordFails) throw new Error('D1_ERROR: network connection lost');
				recorded.push(`credits:${sessionId}`);
			},
		},
		baseUrl: 'https://estori.app',
		nowMs: Date.parse('2026-10-19T15:00:00Z'),
		checkoutPaused: vi.fn(async () => state.paused === true),
	};
	return { deps, calls, keys, expands, consents, recorded, state };
}

describe('starting a plan', () => {
	it('makes the Stripe customer on the first checkout and reuses it after', async () => {
		const { deps, calls } = fake();
		expect(await startCheckout(deps, USER, 'pro')).toMatchObject({ ok: true, value: { sessionId: 'cs_1' } });
		expect(await startCheckout(deps, USER, 'premium')).toMatchObject({ ok: true });
		expect(calls).toEqual(['customer:u1', 'saved:cus_new', 'checkout:cus_new:price_pro', 'checkout:cus_new:price_premium']);
	});

	it('refuses a second subscription, an unknown plan and a deployment without prices', async () => {
		for (const status of ['active', 'trialing', 'past_due'] as const) {
			expect(await startCheckout(fake({ row: row({ status }) }).deps, USER, 'premium')).toEqual({ ok: false, status: 409, message: BILLING_MESSAGES.alreadyPaying });
		}
		expect(await startCheckout(fake({ row: row({ status: 'canceled' }) }).deps, USER, 'pro')).toMatchObject({ ok: true });
		for (const plan of ['basic', 'enterprise', 'gold', null]) expect(await startCheckout(fake().deps, USER, plan)).toMatchObject({ ok: false, status: 400 });
		expect(await startCheckout({ ...fake().deps, priceIds: null }, USER, 'pro')).toEqual({ ok: false, status: 503, message: BILLING_MESSAGES.notSetUp });
		expect(await startCheckout({ ...fake().deps, stripe: null }, USER, 'pro')).toEqual({ ok: false, status: 503, message: BILLING_MESSAGES.notSetUp });
	});
});

describe('moving between Pro and Premium', () => {
	it('moves up now and down at renewal', async () => {
		const up = fake({ row: row({ plan: 'pro' }) });
		expect(await changePlan(up.deps, 'u1', 'premium')).toEqual({ ok: true, value: { requested: true } });
		expect(up.calls).toEqual(['read:sub_1', 'now:price_premium']);
		const down = fake({ row: row({ plan: 'premium' }) });
		expect(await changePlan(down.deps, 'u1', 'pro')).toMatchObject({ ok: true });
		expect(down.calls).toEqual(['read:sub_1', 'renewal:price_pro']);
	});

	it('refuses the same plan, a failing payment, an ending plan, no plan, a second pending change and a declined card', async () => {
		const warnings = quietWarnings();
		expect(await changePlan(fake({ row: row() }).deps, 'u1', 'pro')).toEqual({ ok: false, status: 400, message: "You're already on Pro." });
		expect(await changePlan(fake({ row: row({ status: 'past_due' }) }).deps, 'u1', 'premium')).toEqual({ ok: false, status: 409, message: BILLING_MESSAGES.paymentFailing });
		expect(await changePlan(fake({ row: row({ cancelAtPeriodEnd: true }) }).deps, 'u1', 'premium')).toEqual({ ok: false, status: 409, message: 'Pro ends on November 5. Keep Pro first.' });
		expect(await changePlan(fake().deps, 'u1', 'premium')).toEqual({ ok: false, status: 404, message: BILLING_MESSAGES.noPlan });
		const pending = row({ plan: 'premium', pendingPlan: 'pro', pendingPlanAt: new Date('2026-11-05T10:00:00Z'), stripeScheduleId: 'sub_sched_1' });
		expect(await changePlan(fake({ row: pending }).deps, 'u1', 'pro')).toEqual({ ok: false, status: 409, message: 'You have a change scheduled for November 5. Keep your current plan first.' });
		const declined = fake({ row: row(), failWith: new StripeApiError('Your card was declined.', 402, 'card_declined', 'card_error') });
		expect(await changePlan(declined.deps, 'u1', 'premium')).toEqual({ ok: false, status: 409, message: BILLING_MESSAGES.declined });
		const failed = fake({ row: row(), failWith: new StripeApiError('Something went wrong.', 500, null, 'api_error') });
		expect(await changePlan(failed.deps, 'u1', 'premium')).toEqual({ ok: false, status: 502, message: STRIPE_REQUEST_FAILED_MESSAGE });
		expect(warnings).toHaveBeenCalledTimes(1);
		expect(await changePlan(fake({ row: row() }).deps, 'u1', 'enterprise')).toEqual({ ok: false, status: 400, message: BILLING_MESSAGES.pickPlan });
	});

	it('reaches Stripe again after a declined upgrade once the card changes, and leaves a subscription already on Premium alone', async () => {
		quietWarnings();
		const declined = fake({ row: row(), failWith: new StripeApiError('Your card was declined.', 402, 'card_declined', 'card_error') });
		expect(await changePlan(declined.deps, 'u1', 'premium')).toMatchObject({ status: 409 });
		expect(await changePlan(declined.deps, 'u1', 'premium')).toMatchObject({ status: 409 });
		declined.state.card = 'pm_2';
		delete declined.state.failWith;
		expect(await changePlan(declined.deps, 'u1', 'premium')).toMatchObject({ ok: true });
		expect(declined.keys[0]).toBe(declined.keys[1]);
		expect(declined.keys[2]).not.toBe(declined.keys[0]);
		expect(declined.keys[2]).toContain('-pm_2-');

		const customerDefault = fake({ row: row(), card: null, customerCard: 'pm_9' });
		expect(await changePlan(customerDefault.deps, 'u1', 'premium')).toMatchObject({ ok: true });
		expect(customerDefault.calls).toEqual(['read:sub_1', 'read-customer:cus_1', 'now:price_premium']);
		expect(customerDefault.keys[0]).toContain('-pm_9-');

		const moved = fake({ row: row(), price: 'price_premium' });
		expect(await changePlan(moved.deps, 'u1', 'premium')).toEqual({ ok: true, value: { requested: true } });
		expect(moved.calls).toEqual(['read:sub_1']);
	});

	it('cancels a pending move to Pro when the seller picks Premium again, and checks Stripe dropped it', async () => {
		const { deps, calls } = fake({ row: row({ plan: 'premium', pendingPlan: 'pro', pendingPlanAt: new Date('2026-11-05T10:00:00Z'), stripeScheduleId: 'sub_sched_1' }), schedule: 'sub_sched_1' });
		expect(await changePlan(deps, 'u1', 'premium')).toMatchObject({ ok: true });
		expect(calls).toEqual(['release:sub_sched_1', 'read:sub_1']);
	});

	it('drops a schedule Stripe still has before moving up, and changes nothing when the release did not take', async () => {
		const warnings = quietWarnings();
		const attached = fake({ row: row(), schedule: 'sub_sched_9' });
		expect(await changePlan(attached.deps, 'u1', 'premium')).toMatchObject({ ok: true });
		expect(attached.calls).toEqual(['read:sub_1', 'release:sub_sched_9', 'read:sub_1', 'now:price_premium']);
		const stuck = fake({ row: row(), schedule: 'sub_sched_9', stuck: true });
		expect(await changePlan(stuck.deps, 'u1', 'premium')).toEqual({ ok: false, status: 502, message: STRIPE_REQUEST_FAILED_MESSAGE });
		expect(stuck.calls).toEqual(['read:sub_1', 'release:sub_sched_9', 'read:sub_1']);
		const keep = fake({ row: row({ plan: 'premium', pendingPlan: 'pro', pendingPlanAt: new Date('2026-11-05T10:00:00Z'), stripeScheduleId: 'sub_sched_1' }), schedule: 'sub_sched_1', stuck: true });
		expect(await changePlan(keep.deps, 'u1', 'premium')).toEqual({ ok: false, status: 502, message: STRIPE_REQUEST_FAILED_MESSAGE });
		expect(warnings).toHaveBeenCalledTimes(2);
	});
});

describe('cancelling, keeping the plan, the portal and extra credits', () => {
	it('drops a pending change before cancelling at the period end, and refuses a second cancel', async () => {
		const warnings = quietWarnings();
		const { deps, calls } = fake({ row: row({ plan: 'premium', pendingPlan: 'pro', pendingPlanAt: new Date('2026-11-05T10:00:00Z'), stripeScheduleId: 'sub_sched_1' }), schedule: 'sub_sched_1' });
		expect(await cancelPlan(deps, 'u1')).toMatchObject({ ok: true });
		expect(calls).toEqual(['read:sub_1', 'release:sub_sched_1', 'read:sub_1', 'cancel:sub_1']);
		expect(await cancelPlan(fake({ row: row({ cancelAtPeriodEnd: true }) }).deps, 'u1')).toEqual({ ok: false, status: 409, message: 'Pro already ends on November 5.' });
		expect(await cancelPlan(fake().deps, 'u1')).toEqual({ ok: false, status: 404, message: BILLING_MESSAGES.noPlan });
		const stuck = fake({ row: row({ stripeScheduleId: 'sub_sched_1' }), schedule: 'sub_sched_1', stuck: true });
		expect(await cancelPlan(stuck.deps, 'u1')).toEqual({ ok: false, status: 502, message: STRIPE_REQUEST_FAILED_MESSAGE });
		expect(stuck.calls).toEqual(['read:sub_1', 'release:sub_sched_1', 'read:sub_1']);
		expect(warnings).toHaveBeenCalledTimes(1);
	});

	it('releases a schedule still attached in its last phase, which the row no longer names, before cancelling', async () => {
		quietWarnings();
		const { deps, calls } = fake({ row: row({ plan: 'pro', currentPeriodStart: new Date('2026-11-05T10:00:00Z'), currentPeriodEnd: new Date('2026-12-05T10:00:00Z') }), schedule: 'sub_sched_1' });
		expect(await cancelPlan(deps, 'u1')).toEqual({ ok: true, value: { requested: true } });
		expect(calls).toEqual(['read:sub_1', 'release:sub_sched_1', 'read:sub_1', 'cancel:sub_1']);
		const unscheduled = fake({ row: row() });
		expect(await cancelPlan(unscheduled.deps, 'u1')).toMatchObject({ ok: true });
		expect(unscheduled.calls).toEqual(['read:sub_1', 'cancel:sub_1']);
	});

	it('keeps the plan only when it was set to end, and opens the portal once there are billing details', async () => {
		expect(await resumePlan(fake({ row: row() }).deps, 'u1')).toEqual({ ok: false, status: 409, message: BILLING_MESSAGES.notEnding });
		const ending = fake({ row: row({ cancelAtPeriodEnd: true }) });
		expect(await resumePlan(ending.deps, 'u1')).toMatchObject({ ok: true });
		expect(ending.calls).toEqual(['read:sub_1', 'resume:sub_1']);
		expect(await openPortal(fake().deps, 'u1')).toEqual({ ok: false, status: 404, message: BILLING_MESSAGES.noCustomer });
		expect(await openPortal(fake({ customer: 'cus_1' }).deps, 'u1')).toEqual({ ok: true, value: { url: 'https://billing.stripe.com/p/1' } });
	});

	it('sells extra credits to Premium only, in amounts from 5,000 in thousands', async () => {
		const premium = fake({ customer: 'cus_1' });
		expect(await buyCredits(premium.deps, USER, account('premium'), 12_000)).toMatchObject({ ok: true, value: { sessionId: 'cs_1' } });
		expect(premium.calls).toEqual(['credits:cus_1:12000']);
		expect(await buyCredits(fake().deps, USER, account('pro'), 12_000)).toMatchObject({ ok: false, status: 402, refusal: { limit: 'extraCredits', upgradeTo: 'premium' } });
		for (const credits of [4_000, 5_500, 2_000_000, '5000']) expect(await buyCredits(fake().deps, USER, account('premium'), credits)).toEqual({ ok: false, status: 400, message: BILLING_MESSAGES.creditsAmount });
	});

	it('opens a new checkout for the same amount once the first purchase is recorded, and one for a double click', async () => {
		const { deps, keys, state } = fake({ customer: 'cus_1' });
		await buyCredits(deps, USER, account('premium'), 12_000);
		await buyCredits(deps, USER, account('premium'), 12_000);
		state.purchases = [purchase('cp_old'), purchase('cp_1')];
		await buyCredits(deps, USER, account('premium'), 12_000);
		expect(keys[0]).toBe(keys[1]);
		expect(keys[0]).toMatch(/^billing-credits-u1-12000-none-\d+$/);
		expect(keys[2]).toMatch(/^billing-credits-u1-12000-cp_1-\d+$/);
	});

	it('calls Stripe for no refused amount or plan', async () => {
		const { deps, calls } = fake();
		for (const credits of [0, 4_000, 5_500, 2_000_000, '5000', null]) await buyCredits(deps, USER, account('premium'), credits);
		await buyCredits(deps, USER, account('basic'), 5_000);
		expect(calls).toEqual([]);
	});
});

describe('while billing checkout is paused', () => {
	const PAUSED = { ok: false, status: 503, message: BILLING_CHECKOUT_PAUSED_MESSAGE };

	it("refuses a plan checkout, a plan change and extra credits for the seller's account, asking Stripe nothing", async () => {
		const checkout = fake({ paused: true });
		const change = fake({ paused: true, row: row() });
		const credits = fake({ paused: true, customer: 'cus_1' });
		expect(await startCheckout(checkout.deps, USER, 'pro')).toEqual(PAUSED);
		expect(await changePlan(change.deps, 'u1', 'premium')).toEqual(PAUSED);
		expect(await buyCredits(credits.deps, USER, account('premium'), 12_000)).toEqual(PAUSED);
		expect([...checkout.calls, ...change.calls, ...credits.calls]).toEqual([]);
		for (const { deps } of [checkout, change, credits]) expect(deps.checkoutPaused).toHaveBeenCalledWith('u1');
	});

	it("refuses a real change, up or down, before Stripe is asked, as it refuses the plan the seller is already on", async () => {
		const down = fake({ paused: true, row: row({ plan: 'premium' }) });
		expect(await changePlan(down.deps, 'u1', 'pro')).toEqual(PAUSED);
		const same = fake({ paused: true, row: row() });
		expect(await changePlan(same.deps, 'u1', 'pro')).toEqual(PAUSED);
		expect([...down.calls, ...same.calls]).toEqual([]);
	});

	it('lets a seller keep the current plan, which only drops a scheduled move and charges nothing, but not pick another one', async () => {
		const scheduled = row({ plan: 'premium', pendingPlan: 'pro', pendingPlanAt: new Date('2026-11-05T10:00:00Z'), stripeScheduleId: 'sub_sched_1' });
		const keep = fake({ paused: true, row: scheduled, schedule: 'sub_sched_1' });
		expect(await changePlan(keep.deps, 'u1', 'premium')).toEqual({ ok: true, value: { requested: true } });
		expect(keep.calls).toEqual(['release:sub_sched_1', 'read:sub_1']);
		const other = fake({ paused: true, row: scheduled, schedule: 'sub_sched_1' });
		expect(await changePlan(other.deps, 'u1', 'pro')).toEqual({ ok: false, status: 409, message: 'You have a change scheduled for November 5. Keep your current plan first.' });
		expect(other.calls).toEqual([]);
	});

	it('keeps cancelling, undoing a cancel and the billing portal open', async () => {
		expect(await cancelPlan(fake({ paused: true, row: row() }).deps, 'u1')).toMatchObject({ ok: true });
		expect(await resumePlan(fake({ paused: true, row: row({ cancelAtPeriodEnd: true }) }).deps, 'u1')).toMatchObject({ ok: true });
		expect(await openPortal(fake({ paused: true, customer: 'cus_1' }).deps, 'u1')).toMatchObject({ ok: true });
	});
});

describe('opening an embedded checkout', () => {
	it('a plan checkout answers the client secret, the publishable key and the order', async () => {
		const { deps } = fake();
		expect(await startCheckout(deps, USER, 'pro')).toEqual({
			ok: true,
			value: {
				clientSecret: 'cs_1_secret_x',
				publishableKey: 'pk_test_1',
				sessionId: 'cs_1',
				order: {
					kind: 'plan',
					plan: 'pro',
					priceCents: 4_900,
					includes: ['20,000 AI credits a month', 'Up to 3 live stores, 10 new stores a day', 'Your own domain on each live store', 'The supplier catalog'],
				},
				terms: { consentText: NO_CODE_CONSENT, buttonText: 'Subscribe: $49 a month', dueTodayCents: 4_900 },
			},
		});
		expect(await startCheckout(deps, USER, 'premium')).toMatchObject({ ok: true, value: { order: { plan: 'premium', priceCents: 19_900 }, terms: { buttonText: 'Subscribe: $199 a month', dueTodayCents: 19_900 } } });
	});

	it('a credits checkout answers no terms', async () => {
		const { deps } = fake({ customer: 'cus_1' });
		expect(await buyCredits(deps, USER, account('premium'), 5_000)).toEqual({
			ok: true,
			value: { clientSecret: 'cs_1_secret_x', publishableKey: 'pk_test_1', sessionId: 'cs_1', order: { kind: 'credits', credits: 5_000, amountCents: 750 }, terms: null },
		});
	});

	it('sends Stripe the return page of its own, with the session id left for Stripe to fill in', async () => {
		const returnUrls: string[] = [];
		const { deps } = fake({ customer: 'cus_1' });
		const stripe = deps.stripe;
		if (!stripe) throw new Error('the fake has Stripe');
		deps.stripe = {
			...stripe,
			createSubscriptionCheckoutSession: async (input) => {
				returnUrls.push(input.returnUrl);
				return SESSION;
			},
			createCreditsCheckoutSession: async (input) => {
				returnUrls.push(input.returnUrl);
				return SESSION;
			},
		};
		await startCheckout(deps, USER, 'pro');
		await buyCredits(deps, USER, account('premium'), 5_000);
		expect(returnUrls).toEqual(Array(2).fill('https://estori.app/settings/billing/checkout/return?session_id={CHECKOUT_SESSION_ID}'));
	});

	it('without a publishable key the checkout answers 503 PAYMENTS_NOT_SET_UP_MESSAGE before asking stripe', async () => {
		const plan = fake({ publishableKey: null });
		const credits = fake({ publishableKey: null, customer: 'cus_1' });
		expect(await startCheckout(plan.deps, USER, 'pro')).toEqual({ ok: false, status: 503, message: PAYMENTS_NOT_SET_UP_MESSAGE });
		expect(await buyCredits(credits.deps, USER, account('premium'), 5_000)).toEqual({ ok: false, status: 503, message: PAYMENTS_NOT_SET_UP_MESSAGE });
		expect([...plan.calls, ...credits.calls]).toEqual([]);
	});

	it('answers 502 when Stripe made a session without a client secret', async () => {
		const warnings = quietWarnings();
		const { deps } = fake({ customer: 'cus_1' });
		const stripe = deps.stripe;
		if (!stripe) throw new Error('the fake has Stripe');
		deps.stripe = { ...stripe, createSubscriptionCheckoutSession: async () => ({ ...SESSION, client_secret: null }) };
		expect(await startCheckout(deps, USER, 'pro')).toEqual({ ok: false, status: 502, message: STRIPE_REQUEST_FAILED_MESSAGE });
		expect(warnings).toHaveBeenCalledTimes(1);
	});
});

describe('the terms of an open checkout', () => {
	it('answers the wording of the session as Stripe reads it back, asking for its discounts', async () => {
		const plain = fake({ sessions: [PLAN_SESSION] });
		expect(await checkoutTerms(plain.deps, 'u1', 'cs_plan')).toEqual({ ok: true, value: { consentText: NO_CODE_CONSENT, buttonText: 'Subscribe: $49 a month', dueTodayCents: 4_900 } });
		expect(plain.expands).toEqual([BILLING_CHECKOUT_EXPAND]);
		const coded = fake({ sessions: [withCode({ duration: 'repeating', duration_in_months: 3 })] });
		expect(await checkoutTerms(coded.deps, 'u1', 'cs_plan')).toEqual({
			ok: true,
			value: {
				consentText: 'I agree to the Terms, and that Estori Pro costs $24.50 a month for 3 months, then $49 a month, until I cancel.',
				buttonText: 'Subscribe: $24.50 a month for 3 months, then $49 a month',
				dueTodayCents: 2_450,
			},
		});
	});

	it("terms for a session that isn't the seller's answer 404", async () => {
		const { deps } = fake({ sessions: [{ ...PLAN_SESSION, client_reference_id: 'u2' }] });
		expect(await checkoutTerms(deps, 'u1', 'cs_plan')).toEqual({ ok: false, status: 404, message: BILLING_MESSAGES.noCheckout });
	});

	it('answers 404 for a session Stripe does not know, and for a session billing did not make', async () => {
		const unknown = fake({ sessions: [] });
		expect(await checkoutTerms(unknown.deps, 'u1', 'cs_gone')).toEqual({ ok: false, status: 404, message: BILLING_MESSAGES.noCheckout });
		const store = fake({ sessions: [{ ...PLAN_SESSION, metadata: { checkout_id: 'chk_1' } }] });
		expect(await checkoutTerms(store.deps, 'u1', 'cs_plan')).toEqual({ ok: false, status: 404, message: BILLING_MESSAGES.noCheckout });
	});

	it('answers 400 for a missing or malformed session id, asking Stripe nothing', async () => {
		const { deps, calls } = fake();
		for (const id of [undefined, null, 42, '', 'sub_1', 'cs_a/../b', 'cs_ a']) {
			expect(await checkoutTerms(deps, 'u1', id)).toEqual({ ok: false, status: 400, message: BILLING_MESSAGES.noCheckout });
		}
		expect(calls).toEqual([]);
	});

	it('answers 400 for a credits checkout, which has no renewal, and for one that has closed', async () => {
		const credits = fake({ sessions: [CREDITS_SESSION] });
		expect(await checkoutTerms(credits.deps, 'u1', 'cs_credits')).toEqual({ ok: false, status: 400, message: BILLING_MESSAGES.noRenewalTerms });
		const expired = fake({ sessions: [{ ...PLAN_SESSION, status: 'expired' }] });
		expect(await checkoutTerms(expired.deps, 'u1', 'cs_plan')).toEqual({ ok: false, status: 400, message: CHECKOUT_EXPIRED_MESSAGE });
		const done = fake({ sessions: [{ ...PLAN_SESSION, status: 'complete', payment_status: 'paid' }] });
		expect(await checkoutTerms(done.deps, 'u1', 'cs_plan')).toEqual({ ok: false, status: 400, message: BILLING_MESSAGES.checkoutFinished });
	});

	it('answers 502 and warns, naming the coupon, for a repeating coupon without months', async () => {
		const warnings = quietWarnings();
		const broken = fake({ sessions: [withCode({ id: 'broken_coupon', duration: 'repeating', duration_in_months: null })] });
		expect(await checkoutTerms(broken.deps, 'u1', 'cs_plan')).toEqual({ ok: false, status: 502, message: STRIPE_REQUEST_FAILED_MESSAGE });
		expect(warnings).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(warnings.mock.calls)).toContain('broken_coupon');
	});

	it('answers 503 without Stripe', async () => {
		expect(await checkoutTerms({ ...fake().deps, stripe: null }, 'u1', 'cs_plan')).toEqual({ ok: false, status: 503, message: BILLING_MESSAGES.notSetUp });
	});

	it('answers 502 when Stripe fails to read the session', async () => {
		quietWarnings();
		const { deps } = fake();
		const stripe = deps.stripe;
		if (!stripe) throw new Error('the fake has Stripe');
		deps.stripe = { ...stripe, retrieveCheckoutSession: async () => Promise.reject(new StripeApiError('Something went wrong.', 500, null, 'api_error')) };
		expect(await checkoutTerms(deps, 'u1', 'cs_plan')).toEqual({ ok: false, status: 502, message: STRIPE_REQUEST_FAILED_MESSAGE });
	});
});

describe('agreeing to the terms before paying', () => {
	const AGREED = { sessionId: 'cs_plan', termsVersion: TERMS_VERSION, consentText: NO_CODE_CONSENT };

	it("consent is stored with the server's own wording", async () => {
		const { deps, consents } = fake({ sessions: [PLAN_SESSION] });
		expect(await recordCheckoutConsent(deps, 'u1', AGREED)).toEqual({ ok: true, value: { recorded: true } });
		expect(consents).toEqual([{ sessionId: 'cs_plan', userId: 'u1', plan: 'pro', termsVersion: TERMS_VERSION, consentText: NO_CODE_CONSENT, now: new Date(deps.nowMs) }]);
	});

	it('stores the wording of a promotion code the seller applied, when the page shows the same', async () => {
		const { deps, consents } = fake({ sessions: [withCode()] });
		const shown = 'I agree to the Terms, and that Estori Pro costs $24.50 today, then $49 a month, until I cancel.';
		expect(await recordCheckoutConsent(deps, 'u1', { ...AGREED, consentText: shown })).toEqual({ ok: true, value: { recorded: true } });
		expect(consents[0]?.consentText).toBe(shown);
	});

	it('consent with stale wording answers 409 and stores nothing', async () => {
		const { deps, consents } = fake({ sessions: [withCode()] });
		// The page still shows the price from before the code was applied.
		expect(await recordCheckoutConsent(deps, 'u1', AGREED)).toEqual({ ok: false, status: 409, message: 'The price changed. Check it and agree again.' });
		expect(consents).toEqual([]);
	});

	it('consent with an old terms version answers 400, asking Stripe nothing', async () => {
		const { deps, consents, calls } = fake({ sessions: [PLAN_SESSION] });
		expect(await recordCheckoutConsent(deps, 'u1', { ...AGREED, termsVersion: '2020-01-01' })).toEqual({ ok: false, status: 400, message: TERMS_OUTDATED_MESSAGE });
		expect(consents).toEqual([]);
		expect(calls).toEqual([]);
	});

	it('consent for a credits or expired session answers 400', async () => {
		const credits = fake({ sessions: [CREDITS_SESSION] });
		expect(await recordCheckoutConsent(credits.deps, 'u1', { ...AGREED, sessionId: 'cs_credits' })).toEqual({ ok: false, status: 400, message: BILLING_MESSAGES.noRenewalTerms });
		const expired = fake({ sessions: [{ ...PLAN_SESSION, status: 'expired' }] });
		expect(await recordCheckoutConsent(expired.deps, 'u1', AGREED)).toEqual({ ok: false, status: 400, message: CHECKOUT_EXPIRED_MESSAGE });
		expect([...credits.consents, ...expired.consents]).toEqual([]);
	});

	it("never records consent for another seller's session, which answers 404 before anything is stored", async () => {
		const { deps, consents } = fake({ sessions: [{ ...PLAN_SESSION, client_reference_id: 'u2' }] });
		expect(await recordCheckoutConsent(deps, 'u1', AGREED)).toEqual({ ok: false, status: 404, message: BILLING_MESSAGES.noCheckout });
		expect(consents).toEqual([]);
	});

	it('answers 400 for a body without a session, a terms version and wording', async () => {
		const { deps, calls, consents } = fake({ sessions: [PLAN_SESSION] });
		for (const body of [undefined, null, 'agree', [], {}, { ...AGREED, sessionId: 7 }, { ...AGREED, termsVersion: null }, { ...AGREED, consentText: undefined }]) {
			expect(await recordCheckoutConsent(deps, 'u1', body)).toEqual({ ok: false, status: 400, message: BILLING_MESSAGES.consentRequest });
		}
		expect(calls).toEqual([]);
		expect(consents).toEqual([]);
	});

	it('answers 502 and stores nothing for a promotion it cannot state exactly', async () => {
		quietWarnings();
		const { deps, consents } = fake({ sessions: [withCode({ duration: 'repeating', duration_in_months: null })] });
		expect(await recordCheckoutConsent(deps, 'u1', AGREED)).toEqual({ ok: false, status: 502, message: STRIPE_REQUEST_FAILED_MESSAGE });
		expect(consents).toEqual([]);
	});
});

describe('the status of a checkout', () => {
	const paidPlan: StripeCheckoutSession = { ...PLAN_SESSION, status: 'complete', payment_status: 'paid' };
	const paidCredits: StripeCheckoutSession = { ...CREDITS_SESSION, status: 'complete', payment_status: 'paid' };

	it('answers where each session stands, recording nothing until it is paid', async () => {
		const states: Array<[StripeCheckoutSession, string]> = [
			[PLAN_SESSION, 'open'],
			[{ ...PLAN_SESSION, status: 'expired' }, 'expired'],
			[{ ...PLAN_SESSION, status: 'complete', payment_status: 'unpaid' }, 'processing'],
		];
		for (const [session, state] of states) {
			const { deps, recorded } = fake({ sessions: [session] });
			expect(await checkoutStatus(deps, 'u1', 'cs_plan')).toEqual({ ok: true, value: { state, kind: 'plan' } });
			expect(recorded).toEqual([]);
		}
	});

	it("records a paid plan's subscription for the signed-in seller, and a paid credits purchase", async () => {
		const plan = fake({ sessions: [paidPlan] });
		expect(await checkoutStatus(plan.deps, 'u1', 'cs_plan')).toEqual({ ok: true, value: { state: 'paid', kind: 'plan' } });
		expect(plan.recorded).toEqual(['subscription:cs_plan:sub_9:u1']);
		expect(plan.expands).toEqual([BILLING_CHECKOUT_EXPAND]);
		const credits = fake({ sessions: [paidCredits] });
		expect(await checkoutStatus(credits.deps, 'u1', 'cs_credits')).toEqual({ ok: true, value: { state: 'paid', kind: 'credits' } });
		expect(credits.recorded).toEqual(['credits:cs_credits']);
	});

	it('still answers the state when recording fails, warning once, since the webhook records it too', async () => {
		const warnings = quietWarnings();
		const { deps, recorded } = fake({ sessions: [paidPlan], recordFails: true });
		expect(await checkoutStatus(deps, 'u1', 'cs_plan')).toEqual({ ok: true, value: { state: 'paid', kind: 'plan' } });
		expect(recorded).toEqual([]);
		expect(warnings).toHaveBeenCalledTimes(1);
	});

	it('records no subscription for a paid plan session that has none, and still answers paid', async () => {
		const { deps, recorded } = fake({ sessions: [{ ...paidPlan, subscription: null }] });
		expect(await checkoutStatus(deps, 'u1', 'cs_plan')).toEqual({ ok: true, value: { state: 'paid', kind: 'plan' } });
		expect(recorded).toEqual([]);
	});

	it("answers 404 for another seller's session, and for one billing did not make, recording nothing", async () => {
		const other = fake({ sessions: [{ ...paidPlan, client_reference_id: 'u2' }] });
		expect(await checkoutStatus(other.deps, 'u1', 'cs_plan')).toEqual({ ok: false, status: 404, message: BILLING_MESSAGES.noCheckout });
		const card = fake({ sessions: [{ ...paidPlan, mode: 'setup', metadata: { kind: 'card', estori_user_id: 'u1' } }] });
		expect(await checkoutStatus(card.deps, 'u1', 'cs_plan')).toEqual({ ok: false, status: 404, message: BILLING_MESSAGES.noCheckout });
		expect(await checkoutStatus(fake({ sessions: [] }).deps, 'u1', 'cs_gone')).toEqual({ ok: false, status: 404, message: BILLING_MESSAGES.noCheckout });
		expect([...other.recorded, ...card.recorded]).toEqual([]);
	});

	it('answers 400 for a malformed session id, and 503 without Stripe', async () => {
		const { deps, calls } = fake();
		expect(await checkoutStatus(deps, 'u1', undefined)).toEqual({ ok: false, status: 400, message: BILLING_MESSAGES.noCheckout });
		expect(calls).toEqual([]);
		expect(await checkoutStatus({ ...deps, stripe: null }, 'u1', 'cs_plan')).toEqual({ ok: false, status: 503, message: BILLING_MESSAGES.notSetUp });
	});
});
