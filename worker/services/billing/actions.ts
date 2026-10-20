/**
 * What a seller can do with their plan: start Pro or Premium, move between them, cancel, keep a plan set to end, open
 * the customer portal and buy extra credits. Each asks Stripe and changes no row; the webhook records what Stripe did.
 */

import { BillingService, CreditLedgerService } from '../../database';
import type { SubscriptionRecord } from '../../database/schema';
import { BILLING_PATH, type BillingChangeRequested, type BillingRedirect, type CheckoutStarted } from '../../../shared/types/billing';
import { assertWithinLimit, formatBillingDate, isExtraCreditsAmount, isPaidPlanId, planName, type PlanLimitRefusal } from '../../../shared/types/plans';
import { createLogger } from '../../logger';
import { appBaseUrl } from '../email/links';
import { STRIPE_REQUEST_FAILED_MESSAGE, stripeFromEnv } from '../payments/config';
import { idempotencyBucket, StripeApiError, type StripeCheckoutSession, type StripeClient, type StripePaymentMethodRef, type StripeSubscription } from '../payments/stripe-client';
import { liveSubscription, type BillingAccount } from './account';
import { planOfPrice, stripePriceIds, type StripePriceIds } from './prices';
import { cancelAtPeriodEndReleasingSchedule, pendingScheduleId, releaseSchedule } from './schedules';

const logger = createLogger('BillingActions');

export const BILLING_MESSAGES = {
	notSetUp: "Plans aren't set up on this deployment yet.",
	pickPlan: 'Pick Pro or Premium.',
	alreadyPaying: 'You already have a plan. Change it on the billing page.',
	noPlan: "You don't have Pro or Premium.",
	paymentFailing: "Your last payment didn't go through. Update your card in Manage billing first.",
	declined: 'Your card was declined. Update it in Manage billing, then try again.',
	notEnding: "Your plan isn't set to end.",
	noCustomer: "You don't have billing details yet.",
	creditsAmount: 'Pick 5,000 to 1,000,000 credits, in thousands.',
} as const;

export type BillingActionResult<T> =
	| { ok: true; value: T }
	| { ok: false; status: 400 | 404 | 409 | 502 | 503; message: string }
	| { ok: false; status: 402; refusal: PlanLimitRefusal };

export type BillingStripe = Pick<
	StripeClient,
	| 'createCustomer'
	| 'retrieveCustomer'
	| 'createSubscriptionCheckoutSession'
	| 'createCreditsCheckoutSession'
	| 'retrieveSubscription'
	| 'changeSubscriptionPrice'
	| 'scheduleSubscriptionPrice'
	| 'releaseSubscriptionSchedule'
	| 'cancelAtPeriodEnd'
	| 'resumeSubscription'
	| 'createBillingPortalSession'
>;

export interface BillingActionDeps {
	stripe: BillingStripe | null;
	store: Pick<BillingService, 'customerOf' | 'saveCustomer' | 'subscriptionOf'>;
	ledger: Pick<CreditLedgerService, 'purchasesOf'>;
	priceIds: StripePriceIds | null;
	baseUrl: string;
	nowMs: number;
}

type Failure = Extract<BillingActionResult<never>, { message: string }>;

interface Configured {
	stripe: BillingStripe;
	priceIds: StripePriceIds;
}

const ok = <T>(value: T): BillingActionResult<T> => ({ ok: true, value });
const fail = (status: Failure['status'], message: string): Failure => ({ ok: false, status, message });
const STRIPE_FAILED = fail(502, STRIPE_REQUEST_FAILED_MESSAGE);
const REQUESTED: BillingChangeRequested = { requested: true };

function configured(deps: BillingActionDeps): Configured | null {
	return deps.stripe && deps.priceIds ? { stripe: deps.stripe, priceIds: deps.priceIds } : null;
}

/**
 * One key per account, action and state, rotating with the client's bucket. `state` is whatever a repeat of the action
 * must not share with the first: a double click or a retry is one request, while the same action after a change in
 * between (cancel, keep, cancel again; a new card after a decline; a second purchase) is not served the first's answer.
 */
function idempotencyKey(deps: BillingActionDeps, action: string, userId: string, state: readonly string[]): string {
	return ['billing', action, userId, ...state, String(idempotencyBucket(deps.nowMs))].join('-');
}

/** The subscription row's version: the webhook rebuilds the row, so it moves with every change Stripe confirms. */
function rowVersion(row: SubscriptionRecord): string {
	return String(Math.floor(row.updatedAt.getTime() / 1000));
}

function paymentMethodId(ref: StripePaymentMethodRef | null | undefined): string | null {
	if (!ref) return null;
	return typeof ref === 'string' ? ref : ref.id;
}

/** The payment method Stripe charges the subscription's invoices with: its own default, else the customer's. */
async function chargedPaymentMethod(stripe: BillingStripe, subscription: StripeSubscription): Promise<string> {
	const own = paymentMethodId(subscription.default_payment_method);
	if (own) return own;
	const customer = await stripe.retrieveCustomer(subscription.customer);
	return paymentMethodId(customer.invoice_settings?.default_payment_method) ?? 'none';
}

/** Stripe's answer for a card it couldn't charge, for any other refusal, or the error itself when it isn't Stripe's. */
async function askStripe<T>(call: () => Promise<BillingActionResult<T>>): Promise<BillingActionResult<T>> {
	try {
		return await call();
	} catch (error) {
		if (!(error instanceof StripeApiError)) throw error;
		if (error.type === 'card_error' || error.status === 402) return fail(409, BILLING_MESSAGES.declined);
		logger.warn('Stripe refused a billing request', { status: error.status, code: error.code, type: error.type, message: error.message });
		return STRIPE_FAILED;
	}
}

async function customerOf(deps: BillingActionDeps, stripe: BillingStripe, user: { id: string; email: string }): Promise<string> {
	const stored = await deps.store.customerOf(user.id);
	if (stored) return stored;
	const created = await stripe.createCustomer({ userId: user.id, email: user.email });
	return deps.store.saveCustomer(user.id, created.id, new Date(deps.nowMs));
}

function checkoutStarted(session: StripeCheckoutSession): BillingActionResult<CheckoutStarted> {
	return session.url ? ok({ url: session.url, sessionId: session.id }) : STRIPE_FAILED;
}

function endsOn(row: SubscriptionRecord): string {
	return formatBillingDate(row.currentPeriodEnd.getTime());
}

export async function startCheckout(deps: BillingActionDeps, user: { id: string; email: string }, plan: unknown): Promise<BillingActionResult<CheckoutStarted>> {
	const setup = configured(deps);
	if (!setup) return fail(503, BILLING_MESSAGES.notSetUp);
	if (!isPaidPlanId(plan)) return fail(400, BILLING_MESSAGES.pickPlan);
	if (liveSubscription(await deps.store.subscriptionOf(user.id))) return fail(409, BILLING_MESSAGES.alreadyPaying);
	return askStripe(async () => {
		const customerId = await customerOf(deps, setup.stripe, user);
		const session = await setup.stripe.createSubscriptionCheckoutSession({
			customerId,
			priceId: setup.priceIds[plan],
			userId: user.id,
			plan,
			successUrl: `${deps.baseUrl}${BILLING_PATH}?checkout=success`,
			cancelUrl: `${deps.baseUrl}${BILLING_PATH}?checkout=cancelled`,
			nowMs: deps.nowMs,
		});
		return checkoutStarted(session);
	});
}

/** Premium starts now, prorated; Pro starts at the renewal. Choosing the current plan again drops a pending move. */
export async function changePlan(deps: BillingActionDeps, userId: string, plan: unknown): Promise<BillingActionResult<BillingChangeRequested>> {
	const setup = configured(deps);
	if (!setup) return fail(503, BILLING_MESSAGES.notSetUp);
	if (!isPaidPlanId(plan)) return fail(400, BILLING_MESSAGES.pickPlan);
	const row = liveSubscription(await deps.store.subscriptionOf(userId));
	if (!row) return fail(404, BILLING_MESSAGES.noPlan);
	if (row.status === 'past_due') return fail(409, BILLING_MESSAGES.paymentFailing);
	const current = planName(row.plan);
	if (row.cancelAtPeriodEnd) return fail(409, `${current} ends on ${endsOn(row)}. Keep ${current} first.`);
	const { stripe, priceIds } = setup;
	if (row.pendingPlan !== null) {
		if (plan !== row.plan) {
			return fail(409, `You have a change scheduled for ${formatBillingDate((row.pendingPlanAt ?? row.currentPeriodEnd).getTime())}. Keep your current plan first.`);
		}
		return askStripe(async () => {
			const scheduleId = row.stripeScheduleId ?? pendingScheduleId(await stripe.retrieveSubscription(row.stripeSubscriptionId));
			if (scheduleId && !(await releaseSchedule(stripe, row.stripeSubscriptionId, scheduleId))) return STRIPE_FAILED;
			return ok(REQUESTED);
		});
	}
	if (plan === row.plan) return fail(400, `You're already on ${current}.`);
	return askStripe(async () => {
		let subscription = await stripe.retrieveSubscription(row.stripeSubscriptionId);
		if (plan === 'pro') {
			const idempotency = idempotencyKey(deps, 'change-plan', userId, [plan, rowVersion(row)]);
			await stripe.scheduleSubscriptionPrice({ subscription, priceId: priceIds.pro, idempotencyKey: idempotency });
			return ok(REQUESTED);
		}
		// The row lags the webhook; a subscription Stripe already moved needs nothing more.
		const item = subscription.items.data[0];
		if (item && planOfPrice(item.price, priceIds) === 'premium') return ok(REQUESTED);
		const scheduleId = pendingScheduleId(subscription);
		if (scheduleId) {
			const released = await releaseSchedule(stripe, subscription.id, scheduleId);
			if (!released) return STRIPE_FAILED;
			subscription = released;
		}
		// Keyed on the card too: a retry after a decline and a new card in Manage billing must reach Stripe again, not replay the 402.
		const card = await chargedPaymentMethod(stripe, subscription);
		const idempotency = idempotencyKey(deps, 'change-plan', userId, [plan, card, rowVersion(row)]);
		await stripe.changeSubscriptionPrice({ subscription, priceId: priceIds.premium, idempotencyKey: idempotency });
		return ok(REQUESTED);
	});
}

/** Ends the plan at the period's end, releasing whatever schedule Stripe still has on it first. */
export async function cancelPlan(deps: BillingActionDeps, userId: string): Promise<BillingActionResult<BillingChangeRequested>> {
	const setup = configured(deps);
	if (!setup) return fail(503, BILLING_MESSAGES.notSetUp);
	const row = liveSubscription(await deps.store.subscriptionOf(userId));
	if (!row) return fail(404, BILLING_MESSAGES.noPlan);
	if (row.cancelAtPeriodEnd) return fail(409, `${planName(row.plan)} already ends on ${endsOn(row)}.`);
	const { stripe } = setup;
	return askStripe(async () => {
		const cancelled = await cancelAtPeriodEndReleasingSchedule(stripe, row.stripeSubscriptionId, idempotencyKey(deps, 'cancel', userId, [rowVersion(row)]));
		return cancelled ? ok(REQUESTED) : STRIPE_FAILED;
	});
}

/** Undoes a cancel while the plan is still running. */
export async function resumePlan(deps: BillingActionDeps, userId: string): Promise<BillingActionResult<BillingChangeRequested>> {
	const setup = configured(deps);
	if (!setup) return fail(503, BILLING_MESSAGES.notSetUp);
	const row = liveSubscription(await deps.store.subscriptionOf(userId));
	if (!row) return fail(404, BILLING_MESSAGES.noPlan);
	if (!row.cancelAtPeriodEnd) return fail(409, BILLING_MESSAGES.notEnding);
	const { stripe } = setup;
	return askStripe(async () => {
		const subscription = await stripe.retrieveSubscription(row.stripeSubscriptionId);
		await stripe.resumeSubscription(subscription, idempotencyKey(deps, 'resume', userId, [rowVersion(row)]));
		return ok(REQUESTED);
	});
}

/** Stripe's customer portal, for the card and invoices; it returns to the billing page. */
export async function openPortal(deps: BillingActionDeps, userId: string): Promise<BillingActionResult<BillingRedirect>> {
	const setup = configured(deps);
	if (!setup) return fail(503, BILLING_MESSAGES.notSetUp);
	const customerId = await deps.store.customerOf(userId);
	if (!customerId) return fail(404, BILLING_MESSAGES.noCustomer);
	return askStripe(async () => {
		const portal = await setup.stripe.createBillingPortalSession({ customerId, returnUrl: `${deps.baseUrl}${BILLING_PATH}` });
		return ok({ url: portal.url });
	});
}

/** A checkout for extra credits, at the price from the server's table; the plan and the amount are checked before Stripe is asked. */
export async function buyCredits(deps: BillingActionDeps, user: { id: string; email: string }, account: BillingAccount, credits: unknown): Promise<BillingActionResult<CheckoutStarted>> {
	const setup = configured(deps);
	if (!setup) return fail(503, BILLING_MESSAGES.notSetUp);
	const refusal = assertWithinLimit(account, 'extraCredits');
	if (refusal) return { ok: false, status: 402, refusal };
	if (!isExtraCreditsAmount(credits)) return fail(400, BILLING_MESSAGES.creditsAmount);
	return askStripe(async () => {
		// Keyed on the newest recorded purchase, so buying the same amount again after the first is paid opens a new checkout.
		const purchases = await deps.ledger.purchasesOf(user.id);
		const newest = purchases.at(-1)?.id ?? 'none';
		const customerId = await customerOf(deps, setup.stripe, user);
		const session = await setup.stripe.createCreditsCheckoutSession({
			customerId,
			priceId: setup.priceIds.credits,
			userId: user.id,
			credits,
			successUrl: `${deps.baseUrl}${BILLING_PATH}?credits=success`,
			cancelUrl: `${deps.baseUrl}${BILLING_PATH}`,
			nowMs: deps.nowMs,
			idempotencyKey: idempotencyKey(deps, 'credits', user.id, [String(credits), newest]),
		});
		return checkoutStarted(session);
	});
}

export function billingActionDepsFromEnv(env: Env, request: Request): BillingActionDeps {
	return {
		stripe: stripeFromEnv(env),
		store: new BillingService(env),
		ledger: new CreditLedgerService(env),
		priceIds: stripePriceIds(env.STRIPE_PRICE_IDS),
		baseUrl: appBaseUrl(env, request),
		nowMs: Date.now(),
	};
}
