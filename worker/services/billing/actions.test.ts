import { afterEach, describe, expect, it, vi } from 'vitest';
import { BILLING_CHECKOUT_EXPAND, StripeApiError, type StripeCheckoutSession, type StripeCoupon, type StripeInvoice, type StripeSubscription } from '../payments/stripe-client';
import {
	BILLING_MESSAGES,
	billingHistory,
	buyCredits,
	cancelPlan,
	changePlan,
	checkoutStatus,
	checkoutTerms,
	completeCardSetup,
	invoicePdf,
	payOpenInvoice,
	recordCheckoutConsent,
	resumePlan,
	startCardSetup,
	startCheckout,
	type BillingActionDeps,
} from './actions';
import type { BillingConsentInput } from '../../database/services/BillingService';
import type { CreditPurchaseRecord, SubscriptionRecord } from '../../database/schema';
import type { BillingAccount } from './account';
import { ENGLISH } from '../../../shared/i18n/translate';
import { serverT } from '../i18n/server-t';
import { PLAN_LIMITS } from '../../../shared/types/plans';
import { BILLING_CHECKOUT_PAUSED_MESSAGE } from '../../../shared/types/pauses';
import { CHECKOUT_EXPIRED_MESSAGE, PAYMENTS_NOT_SET_UP_MESSAGE } from '../../../shared/types/billing';
import { TERMS_OUTDATED_MESSAGE, TERMS_VERSION } from '../../../shared/types/legal';

const USER = { id: 'u1', email: 'ana@example.test' };

/** What billing answers when Stripe fails, in Estori's words. */
const PAYMENTS_UNREACHABLE = "We couldn't reach payments. Try again in a moment.";

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
const NO_CODE_DISCLOSURE = 'Pro renews every month at $49 until you cancel. Cancel any time in Estori; it ends at the end of the period.';

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
		/** The sessions Stripe has, by id, as they stand now; a session made is added unless Stripe already has its id. */
		sessions?: StripeCheckoutSession[];
		/** `null` is a deployment without Stripe's publishable key. */
		publishableKey?: string | null;
		recordFails?: boolean;
		/** The customer's invoices as Stripe lists them, newest first; a retrieve finds one by id. */
		invoices?: StripeInvoice[];
		/** What paying an invoice does instead of paying it. */
		payFails?: Error;
		/** What Stripe answers for an invoice's PDF; an error is a request that never got an answer. */
		pdf?: Error | { status: number; body?: string };
	} = {},
) {
	const calls: string[] = [];
	const keys: string[] = [];
	const expands: Array<readonly string[] | undefined> = [];
	const returnUrls: string[] = [];
	const consents: BillingConsentInput[] = [];
	const recorded: string[] = [];
	/** What a create answers: the session as made, which Stripe keeps from then on. A replacement gets an id of its own. */
	const made = (session: StripeCheckoutSession, replaces: string | null | undefined): StripeCheckoutSession => {
		const answer = replaces ? { ...session, id: `${session.id}_after_${replaces}` } : session;
		state.sessions ??= [];
		if (!state.sessions.some((known) => known.id === answer.id)) state.sessions.push(answer);
		return answer;
	};
	const replacing = (replaces: string | null | undefined): string => (replaces ? `:replacing-${replaces}` : '');
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
				calls.push(`checkout:${input.customerId}:${input.priceId}${replacing(input.replaces)}`);
				return made(SESSION, input.replaces);
			},
			createCreditsCheckoutSession: async (input) => {
				calls.push(`credits:${input.customerId}:${input.credits}${replacing(input.replaces)}`);
				keys.push(input.idempotencyKey);
				return made(SESSION, input.replaces);
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
			retrieveCheckoutSession: async (id, expand) => {
				calls.push(`session:${id}`);
				expands.push(expand);
				const found = state.sessions?.find((session) => session.id === id);
				if (!found) throw new StripeApiError(`No such checkout.session: '${id}'`, 404, 'resource_missing', 'invalid_request_error');
				return found;
			},
			createCardSetupSession: async (input) => {
				calls.push(`card-session:${input.customerId}:${input.mode}:${input.afterCardId ?? 'none'}${replacing(input.replaces)}`);
				returnUrls.push(input.returnUrl);
				return made({ ...SESSION, id: 'cs_card', mode: 'setup', client_secret: 'cs_card_secret_x' }, input.replaces);
			},
			setDefaultPaymentMethod: async ({ customerId, subscriptionId, paymentMethodId }) => {
				calls.push(`default-card:${customerId}:${subscriptionId ?? 'none'}:${paymentMethodId}`);
			},
			listInvoices: async (customerId, limit) => {
				calls.push(`list:${customerId}:${limit}`);
				return state.invoices ?? [];
			},
			retrieveInvoice: async (id) => {
				calls.push(`read-invoice:${id}`);
				const found = state.invoices?.find((candidate) => candidate.id === id);
				if (!found) throw new StripeApiError(`No such invoice: '${id}'`, 404, 'resource_missing', 'invalid_request_error');
				return found;
			},
			payInvoice: async (id, paymentMethodId, idempotencyKey) => {
				calls.push(`pay:${id}:${paymentMethodId ?? 'default'}`);
				keys.push(idempotencyKey);
				if (state.payFails) throw state.payFails;
				const found = state.invoices?.find((candidate) => candidate.id === id);
				if (!found) throw new StripeApiError(`No such invoice: '${id}'`, 404, 'resource_missing', 'invalid_request_error');
				return { ...found, status: 'paid', amount_paid: found.amount_due };
			},
			fetchInvoicePdf: async (url) => {
				calls.push(`pdf:${url}`);
				if (state.pdf instanceof Error) throw state.pdf;
				return new Response(state.pdf?.body ?? '%PDF-1.7 estori', { status: state.pdf?.status ?? 200 });
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
		i18n: ENGLISH,
	};
	return { deps, calls, keys, expands, returnUrls, consents, recorded, state };
}

describe("billing's own words", () => {
	it('names no payment provider in anything it tells the seller', () => {
		expect(BILLING_MESSAGES.paymentsUnreachable).toBe(PAYMENTS_UNREACHABLE);
		for (const [name, message] of Object.entries(BILLING_MESSAGES)) expect(message, name).not.toMatch(/stripe/i);
	});
});

describe('starting a plan', () => {
	it('makes the Stripe customer on the first checkout and reuses it after', async () => {
		const { deps, calls } = fake();
		expect(await startCheckout(deps, USER, 'pro')).toMatchObject({ ok: true, value: { sessionId: 'cs_1' } });
		expect(await startCheckout(deps, USER, 'premium')).toMatchObject({ ok: true });
		expect(calls).toEqual(['customer:u1', 'saved:cus_new', 'checkout:cus_new:price_pro', 'session:cs_1', 'checkout:cus_new:price_premium', 'session:cs_1']);
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
		expect(await changePlan(failed.deps, 'u1', 'premium')).toEqual({ ok: false, status: 502, message: PAYMENTS_UNREACHABLE });
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
		expect(await changePlan(stuck.deps, 'u1', 'premium')).toEqual({ ok: false, status: 502, message: PAYMENTS_UNREACHABLE });
		expect(stuck.calls).toEqual(['read:sub_1', 'release:sub_sched_9', 'read:sub_1']);
		const keep = fake({ row: row({ plan: 'premium', pendingPlan: 'pro', pendingPlanAt: new Date('2026-11-05T10:00:00Z'), stripeScheduleId: 'sub_sched_1' }), schedule: 'sub_sched_1', stuck: true });
		expect(await changePlan(keep.deps, 'u1', 'premium')).toEqual({ ok: false, status: 502, message: PAYMENTS_UNREACHABLE });
		expect(warnings).toHaveBeenCalledTimes(2);
	});
});

describe('cancelling, keeping the plan and extra credits', () => {
	it('drops a pending change before cancelling at the period end, and refuses a second cancel', async () => {
		const warnings = quietWarnings();
		const { deps, calls } = fake({ row: row({ plan: 'premium', pendingPlan: 'pro', pendingPlanAt: new Date('2026-11-05T10:00:00Z'), stripeScheduleId: 'sub_sched_1' }), schedule: 'sub_sched_1' });
		expect(await cancelPlan(deps, 'u1')).toMatchObject({ ok: true });
		expect(calls).toEqual(['read:sub_1', 'release:sub_sched_1', 'read:sub_1', 'cancel:sub_1']);
		expect(await cancelPlan(fake({ row: row({ cancelAtPeriodEnd: true }) }).deps, 'u1')).toEqual({ ok: false, status: 409, message: 'Pro already ends on November 5.' });
		expect(await cancelPlan(fake().deps, 'u1')).toEqual({ ok: false, status: 404, message: BILLING_MESSAGES.noPlan });
		const stuck = fake({ row: row({ stripeScheduleId: 'sub_sched_1' }), schedule: 'sub_sched_1', stuck: true });
		expect(await cancelPlan(stuck.deps, 'u1')).toEqual({ ok: false, status: 502, message: PAYMENTS_UNREACHABLE });
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

	it('keeps the plan only when it was set to end', async () => {
		expect(await resumePlan(fake({ row: row() }).deps, 'u1')).toEqual({ ok: false, status: 409, message: BILLING_MESSAGES.notEnding });
		const ending = fake({ row: row({ cancelAtPeriodEnd: true }) });
		expect(await resumePlan(ending.deps, 'u1')).toMatchObject({ ok: true });
		expect(ending.calls).toEqual(['read:sub_1', 'resume:sub_1']);
	});

	it('sells extra credits to Premium only, in amounts from 5,000 in thousands', async () => {
		const premium = fake({ customer: 'cus_1' });
		expect(await buyCredits(premium.deps, USER, account('premium'), 12_000)).toMatchObject({ ok: true, value: { sessionId: 'cs_1' } });
		expect(premium.calls).toEqual(['credits:cus_1:12000', 'session:cs_1']);
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

	it('keeps cancelling and undoing a cancel open', async () => {
		expect(await cancelPlan(fake({ paused: true, row: row() }).deps, 'u1')).toMatchObject({ ok: true });
		expect(await resumePlan(fake({ paused: true, row: row({ cancelAtPeriodEnd: true }) }).deps, 'u1')).toMatchObject({ ok: true });
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
				terms: { consentText: NO_CODE_CONSENT, buttonText: 'Subscribe: $49 a month', dueTodayCents: 4_900, disclosure: NO_CODE_DISCLOSURE },
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
		const { deps } = fake({ customer: 'cus_1', sessions: [SESSION] });
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
		const { deps } = fake({ customer: 'cus_1', sessions: [SESSION] });
		const stripe = deps.stripe;
		if (!stripe) throw new Error('the fake has Stripe');
		deps.stripe = { ...stripe, createSubscriptionCheckoutSession: async () => ({ ...SESSION, client_secret: null }) };
		expect(await startCheckout(deps, USER, 'pro')).toEqual({ ok: false, status: 502, message: PAYMENTS_UNREACHABLE });
		expect(warnings).toHaveBeenCalledTimes(1);
	});
});

describe('starting again within a key bucket', () => {
	it('a start that Stripe answers with a session it has since closed gets a new session, keyed on the closed one, the same on a repeat', async () => {
		const plan = fake({ sessions: [{ ...SESSION, status: 'expired' }] });
		for (let press = 0; press < 2; press++) {
			expect(await startCheckout(plan.deps, USER, 'pro'), `press ${press}`).toMatchObject({ ok: true, value: { sessionId: 'cs_1_after_cs_1', clientSecret: 'cs_1_secret_x' } });
		}
		expect(plan.calls.slice(2, 6)).toEqual(['checkout:cus_new:price_pro', 'session:cs_1', 'checkout:cus_new:price_pro:replacing-cs_1', 'session:cs_1_after_cs_1']);
		expect(plan.expands).toEqual(Array(4).fill(BILLING_CHECKOUT_EXPAND));

		const credits = fake({ customer: 'cus_1', sessions: [{ ...SESSION, status: 'expired' }] });
		expect(await buyCredits(credits.deps, USER, account('premium'), 12_000)).toMatchObject({ ok: true, value: { sessionId: 'cs_1_after_cs_1' } });
		expect(credits.calls).toEqual(['credits:cus_1:12000', 'session:cs_1', 'credits:cus_1:12000:replacing-cs_1', 'session:cs_1_after_cs_1']);
		expect(credits.keys[1]).toBe(credits.keys[0]);

		const card = fake({ customer: 'cus_1', sessions: [{ ...SESSION, id: 'cs_card', mode: 'setup', status: 'expired' }] });
		expect(await startCardSetup(card.deps, USER, 'save')).toMatchObject({ ok: true, value: { sessionId: 'cs_card_after_cs_card', clientSecret: 'cs_card_secret_x' } });
		expect(card.calls).toEqual(['read-customer:cus_1', 'card-session:cus_1:save:none', 'session:cs_card', 'card-session:cus_1:save:none:replacing-cs_card', 'session:cs_card_after_cs_card']);
	});

	it('keeps a session that is still open or already finished, since a finished card setup is completed from the card page', async () => {
		const open = fake({ customer: 'cus_1', sessions: [SESSION] });
		expect(await startCheckout(open.deps, USER, 'pro')).toMatchObject({ ok: true, value: { sessionId: 'cs_1' } });
		const saved = fake({ customer: 'cus_1', sessions: [{ ...SESSION, id: 'cs_card', mode: 'setup', status: 'complete', payment_status: 'no_payment_required' }] });
		expect(await startCardSetup(saved.deps, USER, 'save')).toMatchObject({ ok: true, value: { sessionId: 'cs_card' } });
		expect([...open.calls, ...saved.calls].some((call) => call.includes('replacing'))).toBe(false);
	});

	it('answers the terms of an open session as it stands now, with the code the seller applied before reloading', async () => {
		const { deps } = fake({ customer: 'cus_1', sessions: [withCode({}, { ...PLAN_SESSION, id: 'cs_1' })] });
		expect(await startCheckout(deps, USER, 'pro')).toMatchObject({
			ok: true,
			value: {
				sessionId: 'cs_1',
				terms: {
					consentText: 'I agree to the Terms, and that Estori Pro costs $24.50 today, then $49 a month, until I cancel.',
					buttonText: 'Subscribe: $24.50 today, then $49 a month',
					dueTodayCents: 2_450,
				},
			},
		});
	});
});

describe('the terms of an open checkout', () => {
	it('answers the wording of the session as Stripe reads it back, asking for its discounts', async () => {
		const plain = fake({ sessions: [PLAN_SESSION] });
		expect(await checkoutTerms(plain.deps, 'u1', 'cs_plan')).toEqual({ ok: true, value: { consentText: NO_CODE_CONSENT, buttonText: 'Subscribe: $49 a month', dueTodayCents: 4_900, disclosure: NO_CODE_DISCLOSURE } });
		expect(plain.expands).toEqual([BILLING_CHECKOUT_EXPAND]);
		const coded = fake({ sessions: [withCode({ duration: 'repeating', duration_in_months: 3 })] });
		expect(await checkoutTerms(coded.deps, 'u1', 'cs_plan')).toEqual({
			ok: true,
			value: {
				consentText: 'I agree to the Terms, and that Estori Pro costs $24.50 a month for 3 months, then $49 a month, until I cancel.',
				buttonText: 'Subscribe: $24.50 a month for 3 months, then $49 a month',
				dueTodayCents: 2_450,
				disclosure: 'Pro costs $24.50 a month for 3 months, then renews every month at $49 until you cancel. Cancel any time in Estori; it ends at the end of the period.',
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
		expect(await checkoutTerms(broken.deps, 'u1', 'cs_plan')).toEqual({ ok: false, status: 502, message: PAYMENTS_UNREACHABLE });
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
		expect(await checkoutTerms(deps, 'u1', 'cs_plan')).toEqual({ ok: false, status: 502, message: PAYMENTS_UNREACHABLE });
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
		expect(await recordCheckoutConsent(deps, 'u1', AGREED)).toEqual({ ok: false, status: 502, message: PAYMENTS_UNREACHABLE });
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

/** An invoice of the seller's subscription that Stripe could not collect: open, with the secret that finishes its payment. */
function invoice(overrides: Partial<StripeInvoice> = {}): StripeInvoice {
	return {
		id: 'in_1',
		customer: 'cus_1',
		status: 'open',
		created: 1_760_000_000,
		amount_due: 4_900,
		amount_paid: 0,
		total: 4_900,
		currency: 'usd',
		hosted_invoice_url: 'https://invoice.stripe.com/i/acct/x',
		invoice_pdf: 'https://pay.stripe.com/invoice/x/pdf',
		number: 'ABCD-0001',
		description: null,
		lines: { data: [{ description: '1 x Estori Pro (at $49.00 / month)', amount: 4_900 }] },
		billing_reason: 'subscription_cycle',
		parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_1' } },
		confirmation_secret: { client_secret: 'in_1_secret_x', type: 'payment_intent' },
		...overrides,
	};
}

/** A card setup the seller finished on the page: Stripe has the new card on its SetupIntent. */
const SETUP_SESSION: StripeCheckoutSession = {
	id: 'cs_card',
	mode: 'setup',
	url: null,
	client_secret: null,
	customer: 'cus_1',
	payment_status: 'no_payment_required',
	status: 'complete',
	client_reference_id: null,
	metadata: { kind: 'card', estori_user_id: 'u1', card_mode: 'save' },
	amount_total: null,
	currency: 'usd',
	payment_intent: null,
	setup_intent: { id: 'seti_1', payment_method: 'pm_new' },
};

const PAY_SETUP_SESSION: StripeCheckoutSession = { ...SETUP_SESSION, metadata: { kind: 'card', estori_user_id: 'u1', card_mode: 'pay' } };

const PAST_DUE = row({ status: 'past_due' });

const DECLINED = new StripeApiError('Your card has insufficient funds.', 402, 'card_declined', 'card_error');
const NEEDS_AUTHENTICATION = new StripeApiError('This payment needs the cardholder to authenticate.', 402, 'invoice_payment_intent_requires_action', 'card_error');

describe('starting a card setup', () => {
	it('a card setup needs a customer', async () => {
		const { deps, calls } = fake();
		expect(await startCardSetup(deps, USER, 'save')).toEqual({ ok: false, status: 404, message: BILLING_MESSAGES.noCustomer });
		expect(calls).toEqual([]);
	});

	it("opens a setup session for the seller's customer, with the page to come back to, started from the card they have now", async () => {
		const { deps, calls, returnUrls } = fake({ customer: 'cus_1', customerCard: 'pm_old' });
		expect(await startCardSetup(deps, USER, 'pay')).toEqual({ ok: true, value: { clientSecret: 'cs_card_secret_x', publishableKey: 'pk_test_1', sessionId: 'cs_card', mode: 'pay' } });
		expect(calls).toEqual(['read-customer:cus_1', 'card-session:cus_1:pay:pm_old', 'session:cs_card']);
		expect(returnUrls).toEqual(['https://estori.app/settings/billing/card/return?session_id={CHECKOUT_SESSION_ID}']);
	});

	it('names no earlier card only when the customer has none, and reads one Stripe sent as an object', async () => {
		const none = fake({ customer: 'cus_1' });
		await startCardSetup(none.deps, USER, 'save');
		expect(none.calls).toEqual(['read-customer:cus_1', 'card-session:cus_1:save:none', 'session:cs_card']);
		const asObject = fake({ customer: 'cus_1' });
		const stripe = asObject.deps.stripe;
		if (!stripe) throw new Error('the fake has Stripe');
		asObject.deps.stripe = { ...stripe, retrieveCustomer: async (id) => ({ id, email: null, metadata: null, invoice_settings: { default_payment_method: { id: 'pm_obj' } } }) };
		await startCardSetup(asObject.deps, USER, 'save');
		expect(asObject.calls).toEqual(['card-session:cus_1:save:pm_obj', 'session:cs_card']);
	});

	it("starts from the card Stripe charges: the live subscription's default, else the customer's, else none", async () => {
		const own = fake({ customer: 'cus_1', row: row(), customerCard: 'pm_cus' });
		await startCardSetup(own.deps, USER, 'save');
		expect(own.calls).toEqual(['read:sub_1', 'card-session:cus_1:save:pm_1', 'session:cs_card']);
		const customerDefault = fake({ customer: 'cus_1', row: row(), card: null, customerCard: 'pm_9' });
		await startCardSetup(customerDefault.deps, USER, 'save');
		expect(customerDefault.calls).toEqual(['read:sub_1', 'read-customer:cus_1', 'card-session:cus_1:save:pm_9', 'session:cs_card']);
		const nothing = fake({ customer: 'cus_1', row: row(), card: null });
		await startCardSetup(nothing.deps, USER, 'save');
		expect(nothing.calls).toEqual(['read:sub_1', 'read-customer:cus_1', 'card-session:cus_1:save:none', 'session:cs_card']);
	});

	it('names the new card in the next session once a setup changed the default, and ignores a subscription that has ended', async () => {
		const { deps, calls, state } = fake({ customer: 'cus_1', row: row() });
		await startCardSetup(deps, USER, 'save');
		state.card = 'pm_new';
		await startCardSetup(deps, USER, 'save');
		expect(calls.filter((call) => call.startsWith('card-session:'))).toEqual(['card-session:cus_1:save:pm_1', 'card-session:cus_1:save:pm_new']);
		const ended = fake({ customer: 'cus_1', row: row({ status: 'canceled' }), customerCard: 'pm_cus' });
		await startCardSetup(ended.deps, USER, 'save');
		expect(ended.calls).toEqual(['read-customer:cus_1', 'card-session:cus_1:save:pm_cus', 'session:cs_card']);
	});

	it('answers 400 for any mode but save or pay, asking Stripe nothing', async () => {
		const { deps, calls } = fake({ customer: 'cus_1' });
		for (const mode of ['change', '', 'PAY', null, undefined, 1]) {
			expect(await startCardSetup(deps, USER, mode)).toEqual({ ok: false, status: 400, message: BILLING_MESSAGES.cardMode });
		}
		expect(calls).toEqual([]);
	});

	it('answers 503 without Stripe, and 503 PAYMENTS_NOT_SET_UP_MESSAGE without the publishable key', async () => {
		expect(await startCardSetup({ ...fake({ customer: 'cus_1' }).deps, stripe: null }, USER, 'save')).toEqual({ ok: false, status: 503, message: BILLING_MESSAGES.notSetUp });
		const noKey = fake({ customer: 'cus_1', publishableKey: null });
		expect(await startCardSetup(noKey.deps, USER, 'save')).toEqual({ ok: false, status: 503, message: PAYMENTS_NOT_SET_UP_MESSAGE });
		expect(noKey.calls).toEqual([]);
	});

	it('answers 502 and warns when Stripe made a session without a client secret', async () => {
		const warnings = quietWarnings();
		const { deps } = fake({ customer: 'cus_1', sessions: [SESSION] });
		const stripe = deps.stripe;
		if (!stripe) throw new Error('the fake has Stripe');
		deps.stripe = { ...stripe, createCardSetupSession: async () => ({ ...SESSION, client_secret: null }) };
		expect(await startCardSetup(deps, USER, 'save')).toEqual({ ok: false, status: 502, message: PAYMENTS_UNREACHABLE });
		expect(warnings).toHaveBeenCalledTimes(1);
	});
});

describe('finishing a card setup', () => {
	it('completing a save setup sets the default card on the customer and the subscription', async () => {
		const { deps, calls, expands } = fake({ customer: 'cus_1', row: row(), sessions: [SETUP_SESSION] });
		expect(await completeCardSetup(deps, 'u1', 'cs_card')).toEqual({ ok: true, value: { state: 'saved' } });
		expect(calls).toEqual(['session:cs_card', 'default-card:cus_1:sub_1:pm_new']);
		expect(expands).toEqual([BILLING_CHECKOUT_EXPAND]);
	});

	it("sets only the customer's card when the seller has no live subscription", async () => {
		const none = fake({ customer: 'cus_1', sessions: [SETUP_SESSION] });
		expect(await completeCardSetup(none.deps, 'u1', 'cs_card')).toEqual({ ok: true, value: { state: 'saved' } });
		expect(none.calls).toEqual(['session:cs_card', 'default-card:cus_1:none:pm_new']);
		const ended = fake({ customer: 'cus_1', row: row({ status: 'canceled' }), sessions: [SETUP_SESSION] });
		await completeCardSetup(ended.deps, 'u1', 'cs_card');
		expect(ended.calls).toEqual(['session:cs_card', 'default-card:cus_1:none:pm_new']);
	});

	it('finishing twice sets the same card twice and pays nothing, since a save never pays', async () => {
		const { deps, calls } = fake({ customer: 'cus_1', row: row(), sessions: [SETUP_SESSION], invoices: [invoice()] });
		expect(await completeCardSetup(deps, 'u1', 'cs_card')).toEqual({ ok: true, value: { state: 'saved' } });
		expect(await completeCardSetup(deps, 'u1', 'cs_card')).toEqual({ ok: true, value: { state: 'saved' } });
		expect(calls.filter((call) => call.startsWith('default-card:'))).toEqual(Array(2).fill('default-card:cus_1:sub_1:pm_new'));
		expect(calls.some((call) => call.startsWith('pay:'))).toBe(false);
	});

	it('a setup session that names no mode of its own saves the card and pays nothing', async () => {
		const { deps, calls } = fake({ customer: 'cus_1', row: PAST_DUE, sessions: [{ ...SETUP_SESSION, metadata: { kind: 'card', estori_user_id: 'u1' } }], invoices: [invoice()] });
		expect(await completeCardSetup(deps, 'u1', 'cs_card')).toEqual({ ok: true, value: { state: 'saved' } });
		expect(calls).toEqual(['session:cs_card', 'default-card:cus_1:sub_1:pm_new']);
	});

	it('completing a pay setup pays the open invoice with the new card', async () => {
		const { deps, calls, keys } = fake({ customer: 'cus_1', row: PAST_DUE, sessions: [PAY_SETUP_SESSION], invoices: [invoice()] });
		expect(await completeCardSetup(deps, 'u1', 'cs_card')).toEqual({ ok: true, value: { state: 'paid' } });
		expect(calls).toEqual(['session:cs_card', 'default-card:cus_1:sub_1:pm_new', 'list:cus_1:24', 'pay:in_1:pm_new']);
		expect(keys[0]).toMatch(/^billing-pay-invoice-u1-in_1-pm_new-\d+$/);
	});

	it('a pay setup with no live subscription saves the card and has nothing to pay', async () => {
		const { deps, calls } = fake({ customer: 'cus_1', sessions: [PAY_SETUP_SESSION], invoices: [invoice()] });
		expect(await completeCardSetup(deps, 'u1', 'cs_card')).toEqual({ ok: true, value: { state: 'saved' } });
		expect(calls).toEqual(['session:cs_card', 'default-card:cus_1:none:pm_new']);
	});

	it('a pay setup keeps the saved card when the invoice was already paid, when the bank declines it and when it needs authentication', async () => {
		const settled = fake({ customer: 'cus_1', row: PAST_DUE, sessions: [PAY_SETUP_SESSION], invoices: [invoice({ status: 'paid', amount_paid: 4_900 })] });
		expect(await completeCardSetup(settled.deps, 'u1', 'cs_card')).toEqual({ ok: true, value: { state: 'nothing_due' } });
		expect(settled.calls.some((call) => call.startsWith('pay:'))).toBe(false);
		const declined = fake({ customer: 'cus_1', row: PAST_DUE, sessions: [PAY_SETUP_SESSION], invoices: [invoice()], payFails: DECLINED });
		expect(await completeCardSetup(declined.deps, 'u1', 'cs_card')).toEqual({ ok: true, value: { state: 'declined', message: 'Your card has insufficient funds.' } });
		expect(declined.calls).toContain('default-card:cus_1:sub_1:pm_new');
		const confirm = fake({ customer: 'cus_1', row: PAST_DUE, sessions: [PAY_SETUP_SESSION], invoices: [invoice()], payFails: NEEDS_AUTHENTICATION });
		expect(await completeCardSetup(confirm.deps, 'u1', 'cs_card')).toEqual({ ok: true, value: { state: 'requires_action', clientSecret: 'in_1_secret_x', publishableKey: 'pk_test_1' } });
		expect(confirm.calls).toContain('default-card:cus_1:sub_1:pm_new');
	});

	it("answers 404 for another seller's setup, for a session that isn't a card setup and for a customer that isn't the seller's, setting no card", async () => {
		const sessions: StripeCheckoutSession[] = [
			{ ...SETUP_SESSION, id: 'cs_other', metadata: { kind: 'card', estori_user_id: 'u2', card_mode: 'save' } },
			{ ...SETUP_SESSION, id: 'cs_plan', mode: 'subscription', metadata: { estori_user_id: 'u1', plan: 'pro' }, client_reference_id: 'u1' },
			{ ...SETUP_SESSION, id: 'cs_kind', metadata: { kind: 'credits', estori_user_id: 'u1' } },
			{ ...SETUP_SESSION, id: 'cs_payment', mode: 'payment' },
			{ ...SETUP_SESSION, id: 'cs_cus', customer: 'cus_other' },
		];
		const { deps, calls } = fake({ customer: 'cus_1', row: row(), sessions });
		for (const { id } of sessions) {
			expect(await completeCardSetup(deps, 'u1', id), id).toEqual({ ok: false, status: 404, message: BILLING_MESSAGES.noCheckout });
		}
		expect(await completeCardSetup(deps, 'u1', 'cs_gone')).toEqual({ ok: false, status: 404, message: BILLING_MESSAGES.noCheckout });
		expect(calls.some((call) => call.startsWith('default-card:'))).toBe(false);
	});

	it("answers 404 when the seller has no Stripe customer, since no setup session can be theirs", async () => {
		const { deps, calls } = fake({ sessions: [SETUP_SESSION] });
		expect(await completeCardSetup(deps, 'u1', 'cs_card')).toEqual({ ok: false, status: 404, message: BILLING_MESSAGES.noCheckout });
		expect(calls.some((call) => call.startsWith('default-card:'))).toBe(false);
	});

	it('answers 400 for a setup that is still open or has timed out, setting no card', async () => {
		const open = fake({ customer: 'cus_1', sessions: [{ ...SETUP_SESSION, status: 'open', setup_intent: null }] });
		expect(await completeCardSetup(open.deps, 'u1', 'cs_card')).toEqual({ ok: false, status: 400, message: BILLING_MESSAGES.cardNotSaved });
		const expired = fake({ customer: 'cus_1', sessions: [{ ...SETUP_SESSION, status: 'expired', setup_intent: null }] });
		expect(await completeCardSetup(expired.deps, 'u1', 'cs_card')).toEqual({ ok: false, status: 400, message: CHECKOUT_EXPIRED_MESSAGE });
		expect([...open.calls, ...expired.calls].some((call) => call.startsWith('default-card:'))).toBe(false);
	});

	it("answers 502 and warns when Stripe doesn't say which card was saved, setting no card", async () => {
		const warnings = quietWarnings();
		for (const setup_intent of [null, 'seti_1', { id: 'seti_1', payment_method: null }]) {
			const { deps, calls } = fake({ customer: 'cus_1', row: row(), sessions: [{ ...SETUP_SESSION, setup_intent }] });
			expect(await completeCardSetup(deps, 'u1', 'cs_card')).toEqual({ ok: false, status: 502, message: PAYMENTS_UNREACHABLE });
			expect(calls.some((call) => call.startsWith('default-card:'))).toBe(false);
		}
		expect(warnings).toHaveBeenCalledTimes(3);
	});

	it('answers 400 for a malformed session id, asking Stripe nothing, and 503 without Stripe', async () => {
		const { deps, calls } = fake({ customer: 'cus_1' });
		for (const id of [undefined, null, 7, '', 'sub_1', 'cs_a/../b']) {
			expect(await completeCardSetup(deps, 'u1', id)).toEqual({ ok: false, status: 400, message: BILLING_MESSAGES.noCheckout });
		}
		expect(calls).toEqual([]);
		expect(await completeCardSetup({ ...deps, stripe: null }, 'u1', 'cs_card')).toEqual({ ok: false, status: 503, message: BILLING_MESSAGES.notSetUp });
	});

	it('a concurrent webhook setting the same card does not stop the payment or the save: a key in use or a lock timeout is taken as set', async () => {
		const overlaps = [
			new StripeApiError('Keys for idempotent requests can only be used for one request at a time.', 409, 'idempotency_key_in_use', 'invalid_request_error'),
			new StripeApiError('This object cannot be accessed right now because another API request is accessing it.', 429, 'lock_timeout', 'invalid_request_error'),
		];
		for (const overlap of overlaps) {
			const pay = fake({ customer: 'cus_1', row: PAST_DUE, sessions: [PAY_SETUP_SESSION], invoices: [invoice()] });
			const save = fake({ customer: 'cus_1', row: PAST_DUE, sessions: [SETUP_SESSION], invoices: [invoice()] });
			for (const { deps } of [pay, save]) {
				const stripe = deps.stripe;
				if (!stripe) throw new Error('the fake has Stripe');
				deps.stripe = { ...stripe, setDefaultPaymentMethod: async () => Promise.reject(overlap) };
			}
			expect(await completeCardSetup(pay.deps, 'u1', 'cs_card'), overlap.code ?? '').toEqual({ ok: true, value: { state: 'paid' } });
			expect(pay.calls).toEqual(['session:cs_card', 'list:cus_1:24', 'pay:in_1:pm_new']);
			expect(await completeCardSetup(save.deps, 'u1', 'cs_card')).toEqual({ ok: true, value: { state: 'saved' } });
			expect(save.calls.some((call) => call.startsWith('pay:'))).toBe(false);
		}
	});

	it('any other failure to set the default card, a rate limit among them, still fails the setup and pays nothing', async () => {
		const warnings = quietWarnings();
		const refusals = [new StripeApiError('Too many requests.', 429, 'rate_limit', 'invalid_request_error'), new StripeApiError('Something went wrong.', 500, null, 'api_error')];
		for (const refusal of refusals) {
			const { deps, calls } = fake({ customer: 'cus_1', row: PAST_DUE, sessions: [PAY_SETUP_SESSION], invoices: [invoice()] });
			const stripe = deps.stripe;
			if (!stripe) throw new Error('the fake has Stripe');
			deps.stripe = { ...stripe, setDefaultPaymentMethod: async () => Promise.reject(refusal) };
			expect(await completeCardSetup(deps, 'u1', 'cs_card')).toEqual({ ok: false, status: 502, message: PAYMENTS_UNREACHABLE });
			expect(calls.some((call) => call.startsWith('pay:'))).toBe(false);
		}
		expect(warnings).toHaveBeenCalledTimes(2);
	});

	it('answers 502 and warns when Stripe refuses to set the default card', async () => {
		const warnings = quietWarnings();
		const { deps } = fake({ customer: 'cus_1', row: row(), sessions: [SETUP_SESSION] });
		const stripe = deps.stripe;
		if (!stripe) throw new Error('the fake has Stripe');
		deps.stripe = { ...stripe, setDefaultPaymentMethod: async () => Promise.reject(new StripeApiError('The subscription is canceled.', 400, null, 'invalid_request_error')) };
		expect(await completeCardSetup(deps, 'u1', 'cs_card')).toEqual({ ok: false, status: 502, message: PAYMENTS_UNREACHABLE });
		expect(warnings).toHaveBeenCalledTimes(1);
	});
});

describe('paying a failed invoice', () => {
	it('pays the newest open invoice of the live subscription with the card it renews on', async () => {
		const invoices = [
			invoice({ id: 'in_credits', parent: null }),
			invoice({ id: 'in_other', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_other' } } }),
			invoice({ id: 'in_2' }),
			invoice({ id: 'in_old', created: 1_750_000_000 }),
		];
		const { deps, calls, keys } = fake({ customer: 'cus_1', row: PAST_DUE, invoices });
		expect(await payOpenInvoice(deps, 'u1', null)).toEqual({ ok: true, value: { state: 'paid' } });
		expect(calls).toEqual(['list:cus_1:24', 'read:sub_1', 'pay:in_2:pm_1']);
		expect(keys[0]).toMatch(/^billing-pay-invoice-u1-in_2-pm_1-\d+$/);
	});

	it("charges the customer's default card when the subscription names none, and a card the caller names without asking Stripe which", async () => {
		const customerDefault = fake({ customer: 'cus_1', row: PAST_DUE, invoices: [invoice()], card: null, customerCard: 'pm_9' });
		await payOpenInvoice(customerDefault.deps, 'u1', null);
		expect(customerDefault.calls).toEqual(['list:cus_1:24', 'read:sub_1', 'read-customer:cus_1', 'pay:in_1:pm_9']);
		const named = fake({ customer: 'cus_1', row: PAST_DUE, invoices: [invoice()] });
		await payOpenInvoice(named.deps, 'u1', 'pm_x');
		expect(named.calls).toEqual(['list:cus_1:24', 'pay:in_1:pm_x']);
	});

	it('leaves the card to Stripe when there is none on file', async () => {
		const { deps, calls } = fake({ customer: 'cus_1', row: PAST_DUE, invoices: [invoice()], card: null });
		await payOpenInvoice(deps, 'u1', null);
		expect(calls).toEqual(['list:cus_1:24', 'read:sub_1', 'read-customer:cus_1', 'pay:in_1:default']);
	});

	it('paying when nothing is open answers nothing_due', async () => {
		const settled = fake({ customer: 'cus_1', row: PAST_DUE, invoices: [invoice({ status: 'paid', amount_paid: 4_900 }), invoice({ id: 'in_void', status: 'void' })] });
		expect(await payOpenInvoice(settled.deps, 'u1', null)).toEqual({ ok: true, value: { state: 'nothing_due' } });
		const empty = fake({ customer: 'cus_1', row: PAST_DUE });
		expect(await payOpenInvoice(empty.deps, 'u1', 'pm_x')).toEqual({ ok: true, value: { state: 'nothing_due' } });
		expect([...settled.calls, ...empty.calls].some((call) => call.startsWith('pay:'))).toBe(false);
	});

	it("a declined invoice payment answers declined with the bank's message", async () => {
		const { deps } = fake({ customer: 'cus_1', row: PAST_DUE, invoices: [invoice()], payFails: DECLINED });
		expect(await payOpenInvoice(deps, 'u1', null)).toEqual({ ok: true, value: { state: 'declined', message: 'Your card has insufficient funds.' } });
	});

	it('an invoice that needs authentication answers requires_action with the client secret and the key to finish it with', async () => {
		const { deps, calls } = fake({ customer: 'cus_1', row: PAST_DUE, invoices: [invoice()], payFails: NEEDS_AUTHENTICATION });
		expect(await payOpenInvoice(deps, 'u1', null)).toEqual({ ok: true, value: { state: 'requires_action', clientSecret: 'in_1_secret_x', publishableKey: 'pk_test_1' } });
		expect(calls).toEqual(['list:cus_1:24', 'read:sub_1', 'pay:in_1:pm_1', 'read-invoice:in_1']);
	});

	it('knows an authentication need by its code alone, whatever the status or type of the error', async () => {
		for (const [status, type] of [[402, 'card_error'], [402, 'invalid_request_error'], [400, 'invalid_request_error'], [409, null]] as const) {
			const error = new StripeApiError('This payment needs the cardholder to authenticate.', status, 'invoice_payment_intent_requires_action', type);
			const { deps } = fake({ customer: 'cus_1', row: PAST_DUE, invoices: [invoice()], payFails: error });
			expect(await payOpenInvoice(deps, 'u1', null), `${status} ${type}`).toEqual({ ok: true, value: { state: 'requires_action', clientSecret: 'in_1_secret_x', publishableKey: 'pk_test_1' } });
		}
	});

	it('answers paid when the invoice was paid in between, and 502 when Stripe has no secret to confirm it with', async () => {
		const warnings = quietWarnings();
		const settled = fake({ customer: 'cus_1', row: PAST_DUE, invoices: [invoice()], payFails: NEEDS_AUTHENTICATION });
		const stripe = settled.deps.stripe;
		if (!stripe) throw new Error('the fake has Stripe');
		settled.deps.stripe = { ...stripe, retrieveInvoice: async () => invoice({ status: 'paid', amount_paid: 4_900 }) };
		expect(await payOpenInvoice(settled.deps, 'u1', null)).toEqual({ ok: true, value: { state: 'paid' } });
		const bare = fake({ customer: 'cus_1', row: PAST_DUE, invoices: [invoice({ confirmation_secret: null })], payFails: NEEDS_AUTHENTICATION });
		expect(await payOpenInvoice(bare.deps, 'u1', null)).toEqual({ ok: false, status: 502, message: PAYMENTS_UNREACHABLE });
		expect(warnings).toHaveBeenCalledTimes(1);
	});

	it('answers 503 when the bank wants the seller and the deployment has no publishable key to finish the payment with', async () => {
		const { deps } = fake({ customer: 'cus_1', row: PAST_DUE, invoices: [invoice()], payFails: NEEDS_AUTHENTICATION, publishableKey: null });
		expect(await payOpenInvoice(deps, 'u1', null)).toEqual({ ok: false, status: 503, message: PAYMENTS_NOT_SET_UP_MESSAGE });
	});

	it('answers 502 and warns for any other refusal, and when Stripe answers an invoice that is still not paid', async () => {
		const warnings = quietWarnings();
		const refused = fake({ customer: 'cus_1', row: PAST_DUE, invoices: [invoice()], payFails: new StripeApiError('Something went wrong.', 500, null, 'api_error') });
		expect(await payOpenInvoice(refused.deps, 'u1', null)).toEqual({ ok: false, status: 502, message: PAYMENTS_UNREACHABLE });
		const unpaid = fake({ customer: 'cus_1', row: PAST_DUE, invoices: [invoice()] });
		const stripe = unpaid.deps.stripe;
		if (!stripe) throw new Error('the fake has Stripe');
		unpaid.deps.stripe = { ...stripe, payInvoice: async (id) => invoice({ id, status: 'open' }) };
		expect(await payOpenInvoice(unpaid.deps, 'u1', null)).toEqual({ ok: false, status: 502, message: PAYMENTS_UNREACHABLE });
		expect(warnings).toHaveBeenCalledTimes(2);
	});

	it("a 402 that is neither a card error nor an authentication need is declined with Stripe's message, as a card error is", async () => {
		const refusal = new StripeApiError('Payment required.', 402, 'billing_not_active', 'invalid_request_error');
		const { deps } = fake({ customer: 'cus_1', row: PAST_DUE, invoices: [invoice()], payFails: refusal });
		expect(await payOpenInvoice(deps, 'u1', null)).toEqual({ ok: true, value: { state: 'declined', message: 'Payment required.' } });
	});

	it("answers paid when Stripe's own retry paid the invoice between the list and the payment", async () => {
		for (const refusal of [new StripeApiError('This invoice is already paid.', 400, null, 'invalid_request_error'), new StripeApiError('Something went wrong.', 500, null, 'api_error')]) {
			const { deps, calls } = fake({ customer: 'cus_1', row: PAST_DUE, invoices: [invoice()], payFails: refusal });
			const stripe = deps.stripe;
			if (!stripe) throw new Error('the fake has Stripe');
			deps.stripe = { ...stripe, retrieveInvoice: async (id) => invoice({ id, status: 'paid', amount_paid: 4_900 }) };
			expect(await payOpenInvoice(deps, 'u1', null)).toEqual({ ok: true, value: { state: 'paid' } });
			expect(calls).toEqual(['list:cus_1:24', 'read:sub_1', 'pay:in_1:pm_1']);
		}
	});

	it('keeps the original refusal when the invoice is still open or cannot be read again', async () => {
		const warnings = quietWarnings();
		const refusal = new StripeApiError('Invoice cannot be paid right now.', 400, null, 'invalid_request_error');
		const open = fake({ customer: 'cus_1', row: PAST_DUE, invoices: [invoice()], payFails: refusal });
		expect(await payOpenInvoice(open.deps, 'u1', null)).toEqual({ ok: false, status: 502, message: PAYMENTS_UNREACHABLE });
		expect(open.calls).toContain('read-invoice:in_1');
		const unreadable = fake({ customer: 'cus_1', row: PAST_DUE, invoices: [invoice()], payFails: refusal });
		const stripe = unreadable.deps.stripe;
		if (!stripe) throw new Error('the fake has Stripe');
		unreadable.deps.stripe = { ...stripe, retrieveInvoice: async () => Promise.reject(new StripeApiError('Something went wrong.', 500, null, 'api_error')) };
		expect(await payOpenInvoice(unreadable.deps, 'u1', null)).toEqual({ ok: false, status: 502, message: PAYMENTS_UNREACHABLE });
		expect(warnings).toHaveBeenCalledTimes(2);
		expect(JSON.stringify(warnings.mock.calls)).toContain('Invoice cannot be paid right now.');
	});

	it('reaches Stripe again once the card changed after a decline, and replays a retry with the same card', async () => {
		const { deps, keys, state } = fake({ customer: 'cus_1', row: PAST_DUE, invoices: [invoice()], payFails: DECLINED });
		await payOpenInvoice(deps, 'u1', null);
		await payOpenInvoice(deps, 'u1', null);
		state.card = 'pm_2';
		await payOpenInvoice(deps, 'u1', null);
		expect(keys[0]).toBe(keys[1]);
		expect(keys[2]).not.toBe(keys[0]);
		expect(keys[2]).toContain('-in_1-pm_2-');
	});

	it('pays the open invoice of an unpaid subscription, by Pay now and by a pay setup, which reactivates it', async () => {
		const unpaid = row({ status: 'unpaid' });
		const payNow = fake({ customer: 'cus_1', row: unpaid, invoices: [invoice()] });
		expect(await payOpenInvoice(payNow.deps, 'u1', null)).toEqual({ ok: true, value: { state: 'paid' } });
		expect(payNow.calls).toEqual(['list:cus_1:24', 'read:sub_1', 'pay:in_1:pm_1']);
		const payMode = fake({ customer: 'cus_1', row: unpaid, sessions: [PAY_SETUP_SESSION], invoices: [invoice()] });
		expect(await completeCardSetup(payMode.deps, 'u1', 'cs_card')).toEqual({ ok: true, value: { state: 'paid' } });
		expect(payMode.calls).toEqual(['session:cs_card', 'default-card:cus_1:sub_1:pm_new', 'list:cus_1:24', 'pay:in_1:pm_new']);
		const start = fake({ customer: 'cus_1', row: unpaid });
		await startCardSetup(start.deps, USER, 'pay');
		expect(start.calls.slice(0, 2)).toEqual(['read:sub_1', 'card-session:cus_1:pay:pm_1']);
	});

	it('needs a customer and a subscription that can still be paid, and Stripe', async () => {
		expect(await payOpenInvoice(fake({ row: PAST_DUE }).deps, 'u1', null)).toEqual({ ok: false, status: 404, message: BILLING_MESSAGES.noCustomer });
		const ended = fake({ customer: 'cus_1', row: row({ status: 'canceled' }), invoices: [invoice()] });
		expect(await payOpenInvoice(ended.deps, 'u1', null)).toEqual({ ok: false, status: 404, message: BILLING_MESSAGES.noPlan });
		expect(ended.calls).toEqual([]);
		expect(await payOpenInvoice({ ...fake().deps, stripe: null }, 'u1', null)).toEqual({ ok: false, status: 503, message: BILLING_MESSAGES.notSetUp });
	});
});

describe('the billing history', () => {
	it('lists the last 24 invoices newest first, leaving drafts out', async () => {
		const invoices = [invoice({ id: 'in_3', status: 'draft' }), invoice({ id: 'in_2', status: 'open' }), invoice({ id: 'in_1', status: 'paid', amount_paid: 4_900 })];
		const { deps, calls } = fake({ customer: 'cus_1', invoices });
		const answer = await billingHistory(deps, 'u1');
		expect(answer).toEqual({
			ok: true,
			value: [
				{ id: 'in_2', date: 1_760_000_000_000, description: '1 x Estori Pro (at $49.00 / month)', amountCents: 4_900, currency: 'usd', status: 'open' },
				{ id: 'in_1', date: 1_760_000_000_000, description: '1 x Estori Pro (at $49.00 / month)', amountCents: 4_900, currency: 'usd', status: 'paid' },
			],
		});
		expect(calls).toEqual(['list:cus_1:24']);
	});

	it('is empty for a seller who has never had billing details, asking Stripe nothing', async () => {
		const { deps, calls } = fake();
		expect(await billingHistory(deps, 'u1')).toEqual({ ok: true, value: [] });
		expect(calls).toEqual([]);
	});

	it('answers 503 without Stripe, and 502 with a warning when Stripe fails', async () => {
		const warnings = quietWarnings();
		expect(await billingHistory({ ...fake({ customer: 'cus_1' }).deps, stripe: null }, 'u1')).toEqual({ ok: false, status: 503, message: BILLING_MESSAGES.notSetUp });
		const { deps } = fake({ customer: 'cus_1' });
		const stripe = deps.stripe;
		if (!stripe) throw new Error('the fake has Stripe');
		deps.stripe = { ...stripe, listInvoices: async () => Promise.reject(new StripeApiError('Something went wrong.', 500, null, 'api_error')) };
		expect(await billingHistory(deps, 'u1')).toEqual({ ok: false, status: 502, message: PAYMENTS_UNREACHABLE });
		expect(warnings).toHaveBeenCalledTimes(1);
	});
});

describe('an invoice as a PDF', () => {
	const NOT_FOUND = { ok: false, status: 404, message: BILLING_MESSAGES.noInvoice };

	it("the pdf of another customer's invoice answers 404", async () => {
		const { deps, calls } = fake({ customer: 'cus_1', invoices: [invoice({ customer: 'cus_other' })] });
		expect(await invoicePdf(deps, 'u1', 'in_1')).toEqual(NOT_FOUND);
		expect(calls).toEqual(['read-invoice:in_1']);
	});

	it('answers 404 for an invoice Stripe does not know, a malformed id and a seller with no customer, as for another customer', async () => {
		const unknown = fake({ customer: 'cus_1', invoices: [] });
		expect(await invoicePdf(unknown.deps, 'u1', 'in_gone')).toEqual(NOT_FOUND);
		const malformed = fake({ customer: 'cus_1', invoices: [invoice()] });
		for (const id of [undefined, null, 5, '', 'cs_1', 'in_1/../x', 'in_ 1']) expect(await invoicePdf(malformed.deps, 'u1', id)).toEqual(NOT_FOUND);
		expect(malformed.calls).toEqual([]);
		const noCustomer = fake({ invoices: [invoice()] });
		expect(await invoicePdf(noCustomer.deps, 'u1', 'in_1')).toEqual(NOT_FOUND);
		expect(noCustomer.calls).toEqual([]);
	});

	it('the pdf streams with an estori filename', async () => {
		const { deps, calls } = fake({ customer: 'cus_1', invoices: [invoice()], pdf: { status: 200, body: '%PDF-1.7 invoice' } });
		const answer = await invoicePdf(deps, 'u1', 'in_1');
		if (!answer.ok) throw new Error('the pdf was refused');
		expect(answer.value.status).toBe(200);
		expect(answer.value.headers.get('Content-Type')).toBe('application/pdf');
		expect(answer.value.headers.get('Content-Disposition')).toBe('attachment; filename="estori-invoice-ABCD-0001.pdf"');
		expect(await answer.value.text()).toBe('%PDF-1.7 invoice');
		expect(calls).toEqual(['read-invoice:in_1', 'pdf:https://pay.stripe.com/invoice/x/pdf']);
	});

	it("names the file by the invoice's id when it has no number, and keeps anything unsafe out of the name", async () => {
		const numbered = fake({ customer: 'cus_1', invoices: [invoice({ number: null })] });
		const byId = await invoicePdf(numbered.deps, 'u1', 'in_1');
		if (!byId.ok) throw new Error('the pdf was refused');
		expect(byId.value.headers.get('Content-Disposition')).toBe('attachment; filename="estori-invoice-in_1.pdf"');
		const odd = fake({ customer: 'cus_1', invoices: [invoice({ number: 'A/B "C"\r\nD' })] });
		const sanitized = await invoicePdf(odd.deps, 'u1', 'in_1');
		if (!sanitized.ok) throw new Error('the pdf was refused');
		expect(sanitized.value.headers.get('Content-Disposition')).toBe('attachment; filename="estori-invoice-A-B--C---D.pdf"');
	});

	it('answers 404 for an invoice with no PDF yet', async () => {
		const { deps, calls } = fake({ customer: 'cus_1', invoices: [invoice({ invoice_pdf: null })] });
		expect(await invoicePdf(deps, 'u1', 'in_1')).toEqual({ ok: false, status: 404, message: BILLING_MESSAGES.noInvoicePdf });
		expect(calls).toEqual(['read-invoice:in_1']);
	});

	it('answers 502 with a warning, not an error, for an address the client will not fetch, a failed request and a refusing Stripe', async () => {
		const warnings = quietWarnings();
		const failures: Array<Error | { status: number }> = [new Error('The invoice PDF is not on a Stripe address'), new TypeError('fetch failed'), { status: 500 }, { status: 403 }];
		for (const pdf of failures) {
			const { deps } = fake({ customer: 'cus_1', invoices: [invoice()], pdf });
			expect(await invoicePdf(deps, 'u1', 'in_1')).toEqual({ ok: false, status: 502, message: PAYMENTS_UNREACHABLE });
		}
		expect(warnings).toHaveBeenCalledTimes(4);
	});

	it('answers 503 without Stripe', async () => {
		expect(await invoicePdf({ ...fake({ customer: 'cus_1' }).deps, stripe: null }, 'u1', 'in_1')).toEqual({ ok: false, status: 503, message: BILLING_MESSAGES.notSetUp });
	});
});

describe('card changes and invoices while billing checkout is paused', () => {
	it('card changes and invoice payment stay open while billing checkout is paused', async () => {
		const { deps } = fake({ paused: true, customer: 'cus_1', row: PAST_DUE, sessions: [PAY_SETUP_SESSION], invoices: [invoice()] });
		expect(await startCardSetup(deps, USER, 'pay')).toMatchObject({ ok: true });
		expect(await completeCardSetup(deps, 'u1', 'cs_card')).toEqual({ ok: true, value: { state: 'paid' } });
		expect(await payOpenInvoice(deps, 'u1', null)).toMatchObject({ ok: true });
		expect(await billingHistory(deps, 'u1')).toMatchObject({ ok: true });
		expect(await invoicePdf(deps, 'u1', 'in_1')).toMatchObject({ ok: true });
		expect(deps.checkoutPaused).not.toHaveBeenCalled();
	});
});

/** Spanish and Portuguese write a no-break space between the currency and the amount; the tests read it as a space. */
const plain = (text: string): string => text.replace(/\u00a0/g, ' ');
/** The server's text for a sentence written here with plain spaces after "USD" and "US$". */
const withNoBreakSpaces = (text: string): string => text.replace(/(USD|US\$) (?=\d)/g, '$1\u00a0');

describe("the checkout's wording in the seller's language", () => {
	const SPANISH_CONSENT = 'Acepto los Términos (en inglés) y que Estori Pro se renueva a USD 49 al mes hasta que yo cancele.';
	const PORTUGUESE_CONSENT = 'Concordo com os Termos (em inglês) e com o fato de que o Estori Pro renova a US$ 49 por mês até eu cancelar.';

	it('words the terms a plan checkout opens with, and what it includes, in Spanish and Portuguese', async () => {
		const spanish = fake({ customer: 'cus_1', sessions: [PLAN_SESSION] });
		spanish.deps.i18n = serverT('es');
		const started = await startCheckout(spanish.deps, USER, 'pro');
		if (!started.ok) throw new Error('the checkout starts');
		expect(started.value.terms).toEqual({
			consentText: withNoBreakSpaces(SPANISH_CONSENT),
			buttonText: withNoBreakSpaces('Suscribirse: USD 49 al mes'),
			dueTodayCents: 4_900,
			disclosure: withNoBreakSpaces('Pro se renueva cada mes a USD 49 hasta que canceles. Cancela cuando quieras en Estori; termina al final del período.'),
		});
		expect(started.value.order).toMatchObject({ kind: 'plan', includes: ['20,000 créditos de IA al mes', 'Hasta 3 tiendas publicadas, 10 tiendas nuevas al día', 'Tu propio dominio en cada tienda publicada', 'El catálogo de proveedores'] });

		const portuguese = fake({ customer: 'cus_1', sessions: [PLAN_SESSION] });
		portuguese.deps.i18n = serverT('pt-BR');
		const answered = await startCheckout(portuguese.deps, USER, 'pro');
		if (!answered.ok) throw new Error('the checkout starts');
		expect(plain(answered.value.terms?.consentText ?? '')).toBe(PORTUGUESE_CONSENT);
		expect(plain(answered.value.terms?.buttonText ?? '')).toBe('Assinar: US$ 49 por mês');
		expect(answered.value.order).toMatchObject({ includes: expect.arrayContaining(['20.000 créditos de IA por mês', 'Até 3 lojas no ar, 10 lojas novas por dia']) });
	});

	it('words a promotion code in each language, with its month count', async () => {
		const repeating = fake({ sessions: [withCode({ duration: 'repeating', duration_in_months: 3 })] });
		repeating.deps.i18n = serverT('es');
		expect(await checkoutTerms(repeating.deps, 'u1', 'cs_plan')).toMatchObject({
			ok: true,
			value: {
				consentText: withNoBreakSpaces('Acepto los Términos (en inglés) y que Estori Pro cuesta USD 24.50 al mes durante 3 meses, luego USD 49 al mes, hasta que yo cancele.'),
				buttonText: withNoBreakSpaces('Suscribirse: USD 24.50 al mes durante 3 meses, luego USD 49 al mes'),
			},
		});
		const once = fake({ sessions: [withCode({ duration: 'repeating', duration_in_months: 1 })] });
		once.deps.i18n = serverT('pt-BR');
		const answered = await checkoutTerms(once.deps, 'u1', 'cs_plan');
		if (!answered.ok) throw new Error('the terms are answered');
		expect(plain(answered.value.buttonText)).toBe('Assinar: US$ 24,50 por mês durante 1 mês, depois US$ 49 por mês');
		expect(plain(answered.value.consentText)).toBe('Concordo com os Termos (em inglês) e com o fato de que o Estori Pro custa US$ 24,50 por mês durante 1 mês, depois US$ 49 por mês, até eu cancelar.');
		expect(plain(answered.value.disclosure)).toBe(
			'O plano Pro custa US$ 24,50 por mês durante 1 mês, depois renova todo mês a US$ 49 até você cancelar. Cancele quando quiser no Estori; termina no fim do período.',
		);
	});

	it('stores the wording the seller was shown, in their language, and refuses the same sentence in another', async () => {
		const spanish = fake({ sessions: [PLAN_SESSION] });
		spanish.deps.i18n = serverT('es');
		const agreed = { sessionId: 'cs_plan', termsVersion: TERMS_VERSION, consentText: withNoBreakSpaces(SPANISH_CONSENT) };
		expect(await recordCheckoutConsent(spanish.deps, 'u1', agreed)).toEqual({ ok: true, value: { recorded: true } });
		expect(spanish.consents.map((consent) => consent.consentText)).toEqual([withNoBreakSpaces(SPANISH_CONSENT)]);

		// The English sentence is not what the server words for a Spanish seller, so it is the changed-price refusal and stores nothing.
		const refused = fake({ sessions: [PLAN_SESSION] });
		refused.deps.i18n = serverT('es');
		expect(await recordCheckoutConsent(refused.deps, 'u1', { ...agreed, consentText: NO_CODE_CONSENT })).toEqual({ ok: false, status: 409, message: 'The price changed. Check it and agree again.' });
		expect(refused.consents).toEqual([]);

		const english = fake({ sessions: [PLAN_SESSION] });
		expect(await recordCheckoutConsent(english.deps, 'u1', agreed)).toMatchObject({ ok: false, status: 409 });
		expect(english.consents).toEqual([]);
	});

	it('keeps the English wording byte for byte when the seller speaks English', async () => {
		const english = fake({ customer: 'cus_1', sessions: [PLAN_SESSION] });
		english.deps.i18n = serverT('en');
		expect(await startCheckout(english.deps, USER, 'pro')).toMatchObject({ ok: true, value: { terms: { consentText: NO_CODE_CONSENT, buttonText: 'Subscribe: $49 a month', disclosure: NO_CODE_DISCLOSURE } } });
	});
});
