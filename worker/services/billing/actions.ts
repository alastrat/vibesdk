/**
 * What a seller can do with their plan: start Pro or Premium, move between them, cancel, keep a plan set to end, open
 * the customer portal, buy extra credits, change their card, pay a failed renewal and read their invoices. Each asks
 * Stripe and changes no row; the webhook records what Stripe did. A checkout opens as an embedded session on Estori's
 * own page; agreeing to its terms is recorded before it is paid, and the seller's return may record the payment ahead of
 * the webhook. Changing the card, paying an invoice and the history never check the billing-checkout pause.
 */

import { BillingService, CreditLedgerService } from '../../database';
import type { SubscriptionRecord } from '../../database/schema';
import {
	BILLING_PATH,
	CHECKOUT_EXPIRED_MESSAGE,
	CHECKOUT_KIND_CARD,
	PAYMENTS_NOT_SET_UP_MESSAGE,
	type BillingChangeRequested,
	type BillingRedirect,
	type CardSetupMode,
	type CardSetupStart,
	type CheckoutClientStart,
	type CheckoutConsentRequest,
	type CheckoutOrder,
	type CheckoutStatusView,
	type CheckoutTermsView,
	type InvoicePaymentResult,
	type InvoiceView,
} from '../../../shared/types/billing';
import { isCurrentTermsVersion, TERMS_OUTDATED_MESSAGE, TERMS_VERSION } from '../../../shared/types/legal';
import { assertWithinLimit, formatBillingDate, isExtraCreditsAmount, isPaidPlanId, planName, type PaidPlanId, type PlanLimitRefusal } from '../../../shared/types/plans';
import { BILLING_CHECKOUT_PAUSED_MESSAGE } from '../../../shared/types/pauses';
import { createLogger } from '../../logger';
import { appBaseUrl } from '../email/links';
import { STRIPE_REQUEST_FAILED_MESSAGE, stripeFromEnv } from '../payments/config';
import { isFlagOn } from '../posthog/flags';
import { BILLING_CHECKOUT_EXPAND, idempotencyBucket, StripeApiError, type StripeCheckoutSession, type StripeClient, type StripeInvoice } from '../payments/stripe-client';
import { liveSubscription, type BillingAccount } from './account';
import { billingSessionOf, creditsOrder, planOrder, sessionStateOf, termsViewOf, UnreadablePromotionError } from './checkout-session';
import { checkoutReturnRecorders, type CheckoutReturnRecorder } from './events';
import { HISTORY_LIMIT, chargedPaymentMethod, historyOf, invoiceSubscriptionId, setDefaultCard } from './invoices';
import { planOfPrice, stripePriceIds, type StripePriceIds } from './prices';
import { cancelAtPeriodEndReleasingSchedule, pendingScheduleId, releaseSchedule } from './schedules';
import { billingEventDepsFromEnv } from './wiring';

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
	noCheckout: "We couldn't find that checkout.",
	noRenewalTerms: 'Extra credits have no renewal to agree to.',
	checkoutFinished: 'This checkout is already finished.',
	consentRequest: 'Agree to the terms shown, then try again.',
	priceChanged: 'The price changed. Check it and agree again.',
	cardMode: 'Choose whether to save the card or pay with it.',
	cardNotSaved: "Your card wasn't saved. Try again.",
	noInvoice: "We couldn't find that invoice.",
	noInvoicePdf: "That invoice doesn't have a PDF yet.",
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
	| 'retrieveCheckoutSession'
	| 'createCardSetupSession'
	| 'setDefaultPaymentMethod'
	| 'listInvoices'
	| 'retrieveInvoice'
	| 'payInvoice'
	| 'fetchInvoicePdf'
>;

export interface BillingActionDeps {
	stripe: BillingStripe | null;
	store: Pick<BillingService, 'customerOf' | 'saveCustomer' | 'subscriptionOf'>;
	ledger: Pick<CreditLedgerService, 'purchasesOf'>;
	priceIds: StripePriceIds | null;
	/** Stripe.js's key for the checkout page; null on a deployment that hasn't set one. */
	publishableKey: string | null;
	consents: Pick<BillingService, 'recordConsent' | 'consentFor'>;
	/** Records a paid checkout on the seller's return, the way the webhook does. */
	record: CheckoutReturnRecorder;
	baseUrl: string;
	nowMs: number;
	/** The billing-checkout pause for this seller: it refuses a plan checkout, a plan change and extra credits. */
	checkoutPaused(userId: string): Promise<boolean>;
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

/** Where Stripe sends the seller once a plan or credits payment is done; Stripe fills in the session id. */
function checkoutReturnUrl(deps: BillingActionDeps): string {
	return `${deps.baseUrl}${BILLING_PATH}/checkout/return?session_id={CHECKOUT_SESSION_ID}`;
}

/** The wording of a plan session, or the refusal for a promotion whose terms can't be stated exactly. */
function termsOf(plan: PaidPlanId, session: StripeCheckoutSession): BillingActionResult<CheckoutTermsView> {
	try {
		return ok(termsViewOf(plan, session));
	} catch (error) {
		if (!(error instanceof UnreadablePromotionError)) throw error;
		logger.warn('A checkout was refused because its promotion can not be stated exactly', { sessionId: session.id, couponId: error.couponId, message: error.message });
		return STRIPE_FAILED;
	}
}

/** What Stripe.js starts a session's form with; null, with a warning, for a session that has none and so can't be paid. */
function clientSecretOf(session: StripeCheckoutSession): string | null {
	if (session.client_secret) return session.client_secret;
	logger.warn('Stripe made a checkout session without a client secret', { sessionId: session.id });
	return null;
}

/** What the checkout page starts from; `terms` is null for extra credits, which have no renewal. */
function clientStart(session: StripeCheckoutSession, publishableKey: string, order: CheckoutOrder, terms: CheckoutTermsView | null): BillingActionResult<CheckoutClientStart> {
	const clientSecret = clientSecretOf(session);
	return clientSecret ? ok({ clientSecret, publishableKey, sessionId: session.id, order, terms }) : STRIPE_FAILED;
}

/** Where Stripe sends the seller once a new card is saved; Stripe fills in the session id. */
function cardReturnUrl(deps: BillingActionDeps): string {
	return `${deps.baseUrl}${BILLING_PATH}/card/return?session_id={CHECKOUT_SESSION_ID}`;
}

function endsOn(row: SubscriptionRecord): string {
	return formatBillingDate(row.currentPeriodEnd.getTime());
}

/**
 * Opens an embedded checkout for Pro or Premium. A repeat within the client's bucket gets the same session back as it was
 * made, with no promotion code; `checkoutTerms` answers the wording of the session as it stands.
 */
export async function startCheckout(deps: BillingActionDeps, user: { id: string; email: string }, plan: unknown): Promise<BillingActionResult<CheckoutClientStart>> {
	if (await deps.checkoutPaused(user.id)) return { ok: false, status: 503, message: BILLING_CHECKOUT_PAUSED_MESSAGE };
	const setup = configured(deps);
	if (!setup) return fail(503, BILLING_MESSAGES.notSetUp);
	const { publishableKey } = deps;
	if (!publishableKey) return fail(503, PAYMENTS_NOT_SET_UP_MESSAGE);
	if (!isPaidPlanId(plan)) return fail(400, BILLING_MESSAGES.pickPlan);
	if (liveSubscription(await deps.store.subscriptionOf(user.id))) return fail(409, BILLING_MESSAGES.alreadyPaying);
	return askStripe(async () => {
		const customerId = await customerOf(deps, setup.stripe, user);
		const session = await setup.stripe.createSubscriptionCheckoutSession({
			customerId,
			priceId: setup.priceIds[plan],
			userId: user.id,
			plan,
			returnUrl: checkoutReturnUrl(deps),
			nowMs: deps.nowMs,
		});
		const terms = termsOf(plan, session);
		return terms.ok ? clientStart(session, publishableKey, planOrder(plan), terms.value) : terms;
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
	// After the pending-plan branch above, which only drops a scheduled move and charges nothing, so it stays open.
	if (await deps.checkoutPaused(userId)) return { ok: false, status: 503, message: BILLING_CHECKOUT_PAUSED_MESSAGE };
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
		const card = (await chargedPaymentMethod(stripe, subscription.customer, subscription)) ?? 'none';
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
export async function buyCredits(deps: BillingActionDeps, user: { id: string; email: string }, account: BillingAccount, credits: unknown): Promise<BillingActionResult<CheckoutClientStart>> {
	if (await deps.checkoutPaused(user.id)) return { ok: false, status: 503, message: BILLING_CHECKOUT_PAUSED_MESSAGE };
	const setup = configured(deps);
	if (!setup) return fail(503, BILLING_MESSAGES.notSetUp);
	const { publishableKey } = deps;
	if (!publishableKey) return fail(503, PAYMENTS_NOT_SET_UP_MESSAGE);
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
			returnUrl: checkoutReturnUrl(deps),
			nowMs: deps.nowMs,
			idempotencyKey: idempotencyKey(deps, 'credits', user.id, [String(credits), newest]),
		});
		return clientStart(session, publishableKey, creditsOrder(credits), null);
	});
}

const SESSION_ID = /^cs_[A-Za-z0-9_]+$/;

interface OwnCheckout {
	session: StripeCheckoutSession;
	sold: NonNullable<ReturnType<typeof billingSessionOf>>;
}

/** A session read back from Stripe with its discounts and SetupIntent; one Stripe doesn't have reads as missing. */
async function readCheckout(stripe: BillingStripe, sessionId: unknown): Promise<BillingActionResult<StripeCheckoutSession>> {
	if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return fail(400, BILLING_MESSAGES.noCheckout);
	return askStripe(async () => {
		try {
			return ok(await stripe.retrieveCheckoutSession(sessionId, BILLING_CHECKOUT_EXPAND));
		} catch (error) {
			if (error instanceof StripeApiError && error.status === 404) return fail(404, BILLING_MESSAGES.noCheckout);
			throw error;
		}
	});
}

/** A billing session of this seller's, read back from Stripe with its discounts; one that isn't theirs reads as missing. */
async function ownCheckout(deps: BillingActionDeps, userId: string, sessionId: unknown): Promise<BillingActionResult<OwnCheckout>> {
	const { stripe } = deps;
	if (!stripe) return fail(503, BILLING_MESSAGES.notSetUp);
	const read = await readCheckout(stripe, sessionId);
	if (!read.ok) return read;
	const { value: session } = read;
	const sold = billingSessionOf(session);
	// Other sessions on the Stripe account, a paid-site purchase among them, can carry this seller's id as their reference; only billing's own are answered.
	if (!sold || session.client_reference_id !== userId) return fail(404, BILLING_MESSAGES.noCheckout);
	return ok({ session, sold });
}

/** The seller's own subscription checkout that can still be paid. */
async function openPlanCheckout(deps: BillingActionDeps, userId: string, sessionId: unknown): Promise<BillingActionResult<{ session: StripeCheckoutSession; plan: PaidPlanId }>> {
	const own = await ownCheckout(deps, userId, sessionId);
	if (!own.ok) return own;
	const { session, sold } = own.value;
	if (sold.kind !== 'plan') return fail(400, BILLING_MESSAGES.noRenewalTerms);
	const state = sessionStateOf(session);
	if (state === 'expired') return fail(400, CHECKOUT_EXPIRED_MESSAGE);
	if (state !== 'open') return fail(400, BILLING_MESSAGES.checkoutFinished);
	return ok({ session, plan: sold.plan });
}

/** The consent sentence, button and first payment of the seller's open subscription checkout, as Stripe has it now. */
export async function checkoutTerms(deps: BillingActionDeps, userId: string, sessionId: unknown): Promise<BillingActionResult<CheckoutTermsView>> {
	const open = await openPlanCheckout(deps, userId, sessionId);
	return open.ok ? termsOf(open.value.plan, open.value.session) : open;
}

function consentRequestOf(body: unknown): CheckoutConsentRequest | null {
	if (typeof body !== 'object' || body === null) return null;
	const { sessionId, termsVersion, consentText } = body as Record<string, unknown>;
	return typeof sessionId === 'string' && typeof termsVersion === 'string' && typeof consentText === 'string' ? { sessionId, termsVersion, consentText } : null;
}

/**
 * Keeps the seller's agreement before they pay. The wording they saw must be the server's own for the session as it
 * stands, so a price changed by a promotion code since is refused; what's stored is the server's wording, under the
 * signed-in account. The page confirms the payment only after this answers.
 */
export async function recordCheckoutConsent(deps: BillingActionDeps, userId: string, body: unknown): Promise<BillingActionResult<{ recorded: true }>> {
	const request = consentRequestOf(body);
	if (!request) return fail(400, BILLING_MESSAGES.consentRequest);
	if (!isCurrentTermsVersion(request.termsVersion)) return fail(400, TERMS_OUTDATED_MESSAGE);
	const open = await openPlanCheckout(deps, userId, request.sessionId);
	if (!open.ok) return open;
	const { session, plan } = open.value;
	const terms = termsOf(plan, session);
	if (!terms.ok) return terms;
	if (request.consentText !== terms.value.consentText) return fail(409, BILLING_MESSAGES.priceChanged);
	await deps.consents.recordConsent({ sessionId: session.id, userId, plan, termsVersion: TERMS_VERSION, consentText: terms.value.consentText, now: new Date(deps.nowMs) });
	return ok({ recorded: true });
}

/** Where the seller's checkout stands. Once it's paid the return records it, so the page needn't wait for the webhook. */
export async function checkoutStatus(deps: BillingActionDeps, userId: string, sessionId: unknown): Promise<BillingActionResult<CheckoutStatusView>> {
	const own = await ownCheckout(deps, userId, sessionId);
	if (!own.ok) return own;
	const { session, sold } = own.value;
	const state = sessionStateOf(session);
	if (state === 'paid') await recordReturn(deps, userId, session, sold.kind);
	return ok({ state, kind: sold.kind });
}

/** Best effort: the webhook records the same payment, so a failure here only delays the page. */
async function recordReturn(deps: BillingActionDeps, userId: string, session: StripeCheckoutSession, kind: OwnCheckout['sold']['kind']): Promise<void> {
	try {
		if (kind === 'credits') await deps.record.credits(session.id);
		else if (typeof session.subscription === 'string') await deps.record.subscription(session.id, session.subscription, userId);
	} catch (error) {
		logger.warn("Could not record a paid checkout on the seller's return; the webhook will", { sessionId: session.id, error });
	}
}

const INVOICE_ID = /^in_[A-Za-z0-9_]+$/;

/** Stripe's code for an invoice payment that needs the cardholder to authenticate with their bank, which the page does. */
const INVOICE_REQUIRES_ACTION = 'invoice_payment_intent_requires_action';

const PAID: InvoicePaymentResult = { state: 'paid' };
const SAVED: InvoicePaymentResult = { state: 'saved' };
const NOTHING_DUE: InvoicePaymentResult = { state: 'nothing_due' };

function isCardSetupMode(mode: unknown): mode is CardSetupMode {
	return mode === 'save' || mode === 'pay';
}

/** Opens the form for a new card on the seller's customer; `pay` also pays the failed invoice with the card once it is saved. */
export async function startCardSetup(deps: BillingActionDeps, user: { id: string }, mode: unknown): Promise<BillingActionResult<CardSetupStart>> {
	const { stripe, publishableKey } = deps;
	if (!stripe) return fail(503, BILLING_MESSAGES.notSetUp);
	if (!publishableKey) return fail(503, PAYMENTS_NOT_SET_UP_MESSAGE);
	if (!isCardSetupMode(mode)) return fail(400, BILLING_MESSAGES.cardMode);
	const customerId = await deps.store.customerOf(user.id);
	if (!customerId) return fail(404, BILLING_MESSAGES.noCustomer);
	const live = liveSubscription(await deps.store.subscriptionOf(user.id));
	return askStripe(async () => {
		// The card Stripe charges now is part of the session's key: a finished setup changes it, so the next setup is a new session, not the finished one replayed.
		const subscription = live ? await stripe.retrieveSubscription(live.stripeSubscriptionId) : null;
		const session = await stripe.createCardSetupSession({
			customerId,
			userId: user.id,
			mode,
			afterCardId: await chargedPaymentMethod(stripe, customerId, subscription),
			returnUrl: cardReturnUrl(deps),
			nowMs: deps.nowMs,
		});
		const clientSecret = clientSecretOf(session);
		return clientSecret ? ok({ clientSecret, publishableKey, sessionId: session.id, mode }) : STRIPE_FAILED;
	});
}

/** The card a finished setup saved, from its SetupIntent; null, with a warning, when Stripe doesn't say. */
function savedCardOf(session: StripeCheckoutSession): string | null {
	const intent = session.setup_intent;
	const card = typeof intent === 'object' && intent !== null ? intent.payment_method : null;
	if (!card) logger.warn('A finished card setup does not say which card it saved', { sessionId: session.id });
	return card;
}

/**
 * Makes the card the seller just saved their default, on the customer and on the live subscription, and in `pay` mode
 * pays the failed invoice with it. Repeating it is safe: the page can retry and the webhook can set the same card.
 */
export async function completeCardSetup(deps: BillingActionDeps, userId: string, sessionId: unknown): Promise<BillingActionResult<InvoicePaymentResult>> {
	const { stripe } = deps;
	if (!stripe) return fail(503, BILLING_MESSAGES.notSetUp);
	const read = await readCheckout(stripe, sessionId);
	if (!read.ok) return read;
	const { value: session } = read;
	const customerId = await deps.store.customerOf(userId);
	// A card setup has no client reference; billing's own tags name the seller, and the customer must be the one this seller has.
	const ownSetup = session.mode === 'setup' && session.metadata?.kind === CHECKOUT_KIND_CARD && session.metadata.estori_user_id === userId;
	if (!customerId || !ownSetup || session.customer !== customerId) return fail(404, BILLING_MESSAGES.noCheckout);
	if (session.status === 'expired') return fail(400, CHECKOUT_EXPIRED_MESSAGE);
	if (session.status !== 'complete') return fail(400, BILLING_MESSAGES.cardNotSaved);
	const cardId = savedCardOf(session);
	if (!cardId) return STRIPE_FAILED;
	const subscription = liveSubscription(await deps.store.subscriptionOf(userId));
	return askStripe(async () => {
		await setDefaultCard(stripe, customerId, subscription?.stripeSubscriptionId ?? null, cardId);
		// Only a pay setup, from the failed-payment banner, pays; with no live subscription there is nothing to pay.
		if (session.metadata?.card_mode !== 'pay' || !subscription) return ok(SAVED);
		return payNewestOpenInvoice(deps, stripe, userId, customerId, subscription, cardId);
	});
}

/** The secret that lets the page finish a payment the bank asked the seller to authenticate; an invoice paid meanwhile needs none. */
async function confirmationNeeded(stripe: BillingStripe, invoiceId: string): Promise<BillingActionResult<InvoicePaymentResult>> {
	const invoice = await stripe.retrieveInvoice(invoiceId);
	if (invoice.status === 'paid') return ok(PAID);
	const clientSecret = invoice.confirmation_secret?.client_secret;
	if (!clientSecret) {
		logger.warn('Stripe asked for authentication on an invoice but gave no secret to finish it with', { invoiceId });
		return STRIPE_FAILED;
	}
	return ok({ state: 'requires_action', clientSecret });
}

/**
 * Pays the subscription's newest open invoice with `paymentMethod`, else with the card it renews on. No open invoice is
 * `nothing_due`: Stripe's own retry or an earlier press paid it. Stripe errors other than a card refusal or an
 * authentication need are thrown for `askStripe`.
 */
async function payNewestOpenInvoice(
	deps: BillingActionDeps,
	stripe: BillingStripe,
	userId: string,
	customerId: string,
	subscription: SubscriptionRecord,
	paymentMethod: string | null,
): Promise<BillingActionResult<InvoicePaymentResult>> {
	const invoices = await stripe.listInvoices(customerId, HISTORY_LIMIT);
	const open = invoices.find((invoice) => invoice.status === 'open' && invoiceSubscriptionId(invoice) === subscription.stripeSubscriptionId);
	if (!open) return ok(NOTHING_DUE);
	// Keyed on the card charged: a retry after a decline with another card must reach Stripe, not replay the decline.
	const card = paymentMethod ?? (await chargedPaymentMethod(stripe, customerId, await stripe.retrieveSubscription(subscription.stripeSubscriptionId)));
	try {
		const paid = await stripe.payInvoice(open.id, card, idempotencyKey(deps, 'pay-invoice', userId, [open.id, card ?? 'none']));
		if (paid.status === 'paid') return ok(PAID);
		logger.warn('Stripe answered an invoice payment without the invoice being paid', { invoiceId: open.id, status: paid.status });
		return STRIPE_FAILED;
	} catch (error) {
		if (!(error instanceof StripeApiError)) throw error;
		// By code alone: the status and type that carry an authentication need are Stripe's to change.
		if (error.code === INVOICE_REQUIRES_ACTION) return confirmationNeeded(stripe, open.id);
		if (error.type === 'card_error') return ok({ state: 'declined', message: error.message });
		throw error;
	}
}

/** Pays the failed invoice with `paymentMethod`, or with the card on file when null; a bank that wants the seller's confirmation answers `requires_action`. */
export async function payOpenInvoice(deps: BillingActionDeps, userId: string, paymentMethod: string | null): Promise<BillingActionResult<InvoicePaymentResult>> {
	const { stripe } = deps;
	if (!stripe) return fail(503, BILLING_MESSAGES.notSetUp);
	const customerId = await deps.store.customerOf(userId);
	if (!customerId) return fail(404, BILLING_MESSAGES.noCustomer);
	const subscription = liveSubscription(await deps.store.subscriptionOf(userId));
	if (!subscription) return fail(404, BILLING_MESSAGES.noPlan);
	return askStripe(() => payNewestOpenInvoice(deps, stripe, userId, customerId, subscription, paymentMethod));
}

/** The seller's last 24 invoices, newest first; a seller with no billing details has none. */
export async function billingHistory(deps: BillingActionDeps, userId: string): Promise<BillingActionResult<InvoiceView[]>> {
	const { stripe } = deps;
	if (!stripe) return fail(503, BILLING_MESSAGES.notSetUp);
	const customerId = await deps.store.customerOf(userId);
	if (!customerId) return ok([]);
	return askStripe(async () => ok(historyOf(await stripe.listInvoices(customerId, HISTORY_LIMIT))));
}

/** The file name of an invoice's PDF: its number, else its id, with nothing that could break the header it is sent in. */
function pdfFilename(invoice: StripeInvoice): string {
	return `estori-invoice-${(invoice.number ?? invoice.id).replace(/[^A-Za-z0-9_-]/g, '-')}.pdf`;
}

/** The PDF of the seller's own invoice, streamed through Estori so Stripe's address never reaches the browser. Another customer's invoice reads as missing. */
export async function invoicePdf(deps: BillingActionDeps, userId: string, invoiceId: unknown): Promise<BillingActionResult<Response>> {
	const { stripe } = deps;
	if (!stripe) return fail(503, BILLING_MESSAGES.notSetUp);
	if (typeof invoiceId !== 'string' || !INVOICE_ID.test(invoiceId)) return fail(404, BILLING_MESSAGES.noInvoice);
	const customerId = await deps.store.customerOf(userId);
	if (!customerId) return fail(404, BILLING_MESSAGES.noInvoice);
	return askStripe(async () => {
		let invoice: StripeInvoice;
		try {
			invoice = await stripe.retrieveInvoice(invoiceId);
		} catch (error) {
			if (error instanceof StripeApiError && error.status === 404) return fail(404, BILLING_MESSAGES.noInvoice);
			throw error;
		}
		if (invoice.customer !== customerId) return fail(404, BILLING_MESSAGES.noInvoice);
		if (!invoice.invoice_pdf) return fail(404, BILLING_MESSAGES.noInvoicePdf);
		let upstream: Response;
		try {
			upstream = await stripe.fetchInvoicePdf(invoice.invoice_pdf);
		} catch (error) {
			logger.warn("Could not fetch an invoice's PDF", { invoiceId: invoice.id, error });
			return STRIPE_FAILED;
		}
		if (!upstream.ok || !upstream.body) {
			logger.warn('Stripe did not serve an invoice PDF', { invoiceId: invoice.id, status: upstream.status });
			return STRIPE_FAILED;
		}
		return ok(
			new Response(upstream.body, {
				headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${pdfFilename(invoice)}"`, 'Cache-Control': 'private, no-store' },
			}),
		);
	});
}

export function billingActionDepsFromEnv(env: Env, request: Request): BillingActionDeps {
	const billing = new BillingService(env);
	return {
		stripe: stripeFromEnv(env),
		store: billing,
		consents: billing,
		ledger: new CreditLedgerService(env),
		priceIds: stripePriceIds(env.STRIPE_PRICE_IDS),
		publishableKey: env.STRIPE_PUBLISHABLE_KEY || null,
		record: checkoutReturnRecorders(billingEventDepsFromEnv(env)),
		baseUrl: appBaseUrl(env, request),
		nowMs: Date.now(),
		checkoutPaused: (userId) => isFlagOn(env, 'billing-checkout-paused', userId),
	};
}
