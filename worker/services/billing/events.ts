/**
 * Billing's Stripe events. Each is recorded once in billing_events, in the same batch as what it changes. Rows are
 * rebuilt from Stripe's API at that moment, so retries and out-of-order deliveries converge on Stripe's latest state.
 * Emails go out only after the batch commits.
 */

import type { BillingService, BillingEventInput } from '../../database/services/BillingService';
import type { CreditLedgerService } from '../../database/services/CreditLedgerService';
import type { SubscriptionRecord } from '../../database/schema';
import { CHECKOUT_KIND_CARD, CHECKOUT_KIND_CREDITS, LIVE_SUBSCRIPTION_STATUSES, type BillingEventResult } from '../../../shared/types/billing';
import { EXTRA_CREDITS, extraCreditsPriceCents, isExtraCreditsAmount } from '../../../shared/types/plans';
import { createLogger } from '../../logger';
import { generateId } from '../../utils/idGenerator';
import type { PlatformAlert } from '../alerts/platform-alerts';
import { isCheckoutSession } from '../payments/fulfill';
import { idempotencyBucket, type StripeCharge, type StripeClient, type StripeInvoice, type StripeSubscriptionSchedule } from '../payments/stripe-client';
import type { StripeEvent } from '../payments/webhook';
import { subscriptionEventsFor, type BillingAnalyticsEvent } from '../posthog/billing-events';
import { heldPeriodKey, liveSubscription, type BillingAccount } from './account';
import { invoiceSubscriptionId, setDefaultCard } from './invoices';
import type { PlannedNotice } from './notices';
import { addMonths } from './periods';
import type { StripePriceIds } from './prices';
import { noticesFor, subscriptionRowFrom } from './subscription-row';

const logger = createLogger('BillingEvents');

export type BillingEventOutcome = 'applied' | 'duplicate' | 'ignored' | 'refused';

export interface BillingEventDeps {
	stripe: Pick<StripeClient, 'retrieveSubscription' | 'retrieveCheckoutSession' | 'setDefaultPaymentMethod' | 'updateSubscriptionMetadata'>;
	store: Pick<BillingService, 'eventSeen' | 'userOfCustomer' | 'subscriptionOf' | 'sentNoticeKeys' | 'recordEvent' | 'consentFor'>;
	ledger: Pick<CreditLedgerService, 'purchaseBySession' | 'purchaseByPaymentIntent' | 'settle'>;
	priceIds: StripePriceIds | null;
	/** The account's plan and credit period at `nowMs`, from its stored subscription row. */
	account(userId: string, nowMs: number): Promise<EventAccount>;
	/** The same, as it will be once `row` is written. */
	accountWith(userId: string, row: SubscriptionRecord, nowMs: number): Promise<EventAccount>;
	/** Sends the notices; answers those that didn't go out, though a resend could reach the seller. */
	notify(userId: string, notices: readonly PlannedNotice[]): Promise<readonly PlannedNotice[]>;
	alert(alert: PlatformAlert): Promise<void>;
	nowMs(): number;
	/** Sends billing's analytics events about the account; called only once the event is recorded the first time. Never throws. */
	track(userId: string, events: readonly BillingAnalyticsEvent[]): Promise<void>;
}

type EventAccount = Pick<BillingAccount, 'billing' | 'period' | 'limits' | 'subscription'>;

export interface SubscriptionTarget {
	eventId: string;
	eventType: string;
	subscriptionId: string;
	/** The account the checkout was started for, when the event names one. */
	expectedUserId: string | null;
	invoice: StripeInvoice | null;
}

const isLive = (status: string): boolean => (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function hasStringId(value: unknown): value is Record<string, unknown> & { id: string } {
	return isRecord(value) && typeof value.id === 'string';
}

function isStripeInvoice(value: unknown): value is StripeInvoice {
	return hasStringId(value) && typeof value.amount_paid === 'number' && typeof value.currency === 'string' && (value.parent === null || isRecord(value.parent));
}

function isStripeSchedule(value: unknown): value is Pick<StripeSubscriptionSchedule, 'id' | 'subscription' | 'released_subscription'> {
	return hasStringId(value) && (typeof value.subscription === 'string' || typeof value.released_subscription === 'string');
}

function isStripeCharge(value: unknown): value is StripeCharge {
	return hasStringId(value) && (typeof value.payment_intent === 'string' || value.payment_intent === null) && typeof value.amount_refunded === 'number';
}

/** The account named by Stripe's metadata, when the stored customer and the checkout agree; otherwise null. */
async function accountOf(deps: BillingEventDeps, metadataUserId: string | null, customerId: string | null, expectedUserId: string | null): Promise<string | null> {
	if (!metadataUserId) return null;
	if (expectedUserId !== null && expectedUserId !== metadataUserId) return null;
	const customerUserId = customerId ? await deps.store.userOfCustomer(customerId) : null;
	return customerUserId === metadataUserId ? metadataUserId : null;
}

/**
 * Sends an event's notices once its batch has committed. Each was claimed in that batch, and Stripe's own emails are
 * off, so one that couldn't go out is raised for someone to send by hand.
 */
async function notifyOrAlert(deps: BillingEventDeps, userId: string, notices: readonly PlannedNotice[]): Promise<void> {
	for (const notice of await deps.notify(userId, notices)) {
		const { kind } = notice.email;
		await deps.alert({
			kind: 'billing-email-failed',
			subject: notice.key,
			message: `The ${kind.replace(/_/g, ' ')} email to account ${userId} couldn't be sent, and it is recorded as sent, so it won't be tried again. Send it by hand.`,
			details: [
				['Account', userId],
				['Email', kind],
				['Notice key', notice.key],
			],
		});
	}
}

/** Records the event with its effects; a concurrent delivery of the same event that wrote first makes this one a duplicate. */
async function recordOnce(deps: BillingEventDeps, input: BillingEventInput): Promise<'recorded' | 'duplicate'> {
	try {
		await deps.store.recordEvent(input);
		return 'recorded';
	} catch (error) {
		// Anything else is retried by Stripe.
		if (await deps.store.eventSeen(input.event.id)) return 'duplicate';
		throw error;
	}
}

/**
 * A rebuilt row's version is at least a second past the one it replaces: the plan actions key their Stripe calls on it
 * in whole seconds, so two rebuilds in one second must still move it.
 */
function rebuiltAt(previous: SubscriptionRecord | null, nowMs: number): Date {
	return new Date(previous ? Math.max(nowMs, previous.updatedAt.getTime() + 1000) : nowMs);
}

/**
 * A paid invoice can end a grace hold (whose pool is 0) or bring a bigger pool; the repair run can find a hold that
 * ended without its event. A failed renewal leaves the stored pool alone, so usage from before it isn't moved onto purchases.
 */
function poolMayChange(previous: SubscriptionRecord | null, next: SubscriptionRecord, eventType: string): boolean {
	if (eventType === 'invoice.paid') return true;
	return previous?.stripeSubscriptionId === next.stripeSubscriptionId && previous.status === 'past_due' && (next.status === 'active' || next.status === 'trialing');
}

/** The pool the account's open period takes once `next` is written, as the next charged step would store it. */
async function poolWith(deps: BillingEventDeps, userId: string, next: SubscriptionRecord, nowMs: number): Promise<BillingEventInput['pool']> {
	const account = await deps.accountWith(userId, next, nowMs);
	return account.billing ? { periodKey: account.period.key, pool: account.limits.aiCredits } : null;
}

export async function applySubscription(deps: BillingEventDeps, input: SubscriptionTarget): Promise<BillingEventOutcome> {
	if (await deps.store.eventSeen(input.eventId)) return 'duplicate';
	const subscription = await deps.stripe.retrieveSubscription(input.subscriptionId);
	const now = new Date(deps.nowMs());
	const event = (userId: string | null, result: BillingEventResult) => ({ id: input.eventId, type: input.eventType, objectId: subscription.id, userId, result });
	const record = (userId: string | null, result: BillingEventResult) => deps.store.recordEvent({ event: event(userId, result), now });

	const userId = await accountOf(deps, subscription.metadata?.estori_user_id ?? null, subscription.customer, input.expectedUserId);
	if (!userId) {
		await deps.alert({ kind: 'billing-mismatch', subject: subscription.id, message: "The subscription's account doesn't match its Stripe customer, so nothing changed." });
		await record(null, 'refused');
		return 'refused';
	}
	const rebuilt = subscriptionRowFrom(subscription, userId, deps.priceIds, now.getTime());
	if (!rebuilt) {
		await deps.alert({ kind: 'billing-unknown-price', subject: subscription.id, message: 'The subscription has a price that is neither Pro nor Premium, so nothing changed.' });
		await record(userId, 'refused');
		return 'refused';
	}
	const previous = await deps.store.subscriptionOf(userId);
	const next: SubscriptionRecord = { ...rebuilt, updatedAt: rebuiltAt(previous, now.getTime()) };
	const replacing = previous !== null && previous.stripeSubscriptionId !== next.stripeSubscriptionId && isLive(previous.status);
	if (previous && replacing) {
		if (!isLive(next.status)) {
			await record(userId, 'ignored');
			return 'ignored';
		}
		// Two live subscriptions: the one Stripe created first is kept.
		const keepPrevious = previous.stripeCreatedAt.getTime() <= next.stripeCreatedAt.getTime();
		const [kept, extra] = keepPrevious ? [previous, next] : [next, previous];
		await deps.alert({
			kind: 'billing-second-subscription',
			subject: extra.stripeSubscriptionId,
			message: `The account pays through two subscriptions. Estori keeps ${kept.stripeSubscriptionId}; cancel and refund ${extra.stripeSubscriptionId} in Stripe.`,
		});
		if (keepPrevious) {
			await record(userId, 'refused');
			return 'refused';
		}
	}
	const planned = replacing ? [] : noticesFor(previous, next, { eventType: input.eventType, invoice: input.invoice });
	const alreadySent = await deps.store.sentNoticeKeys(userId, planned.map((notice) => notice.key));
	const notices = planned.filter((notice) => !alreadySent.has(notice.key));
	const pool = poolMayChange(previous, next, input.eventType) ? await poolWith(deps, userId, next, now.getTime()) : null;
	const recorded = await recordOnce(deps, { event: event(userId, 'applied'), row: next, pool, notices: notices.map((notice) => ({ key: notice.key, kind: notice.email.kind })), now });
	if (recorded === 'duplicate') return 'duplicate';
	// Like its notices, a subscription that replaces another live one starts nothing new for the account.
	if (!replacing) {
		const failedAttempt = input.eventType === 'invoice.payment_failed' ? (input.invoice?.attempt_count ?? 1) : null;
		await deps.track(userId, subscriptionEventsFor({ previous, next, failedAttempt }));
	}
	await notifyOrAlert(deps, userId, notices);
	return 'applied';
}

/**
 * A finished card setup makes its card the default for the customer's invoices and the live subscription. The seller's
 * return runs the same step, and each call is keyed on the card, so either can come first. Stripe is changed before the
 * event is recorded, so a call that fails is retried rather than recorded as done. It never pays an invoice: only the
 * page's pay mode, with the seller there for the bank's confirmation, does.
 */
export async function applyCardSetup(deps: BillingEventDeps, input: { eventId: string; eventType: string; sessionId: string }): Promise<BillingEventOutcome> {
	if (await deps.store.eventSeen(input.eventId)) return 'duplicate';
	const session = await deps.stripe.retrieveCheckoutSession(input.sessionId, ['setup_intent']);
	const now = new Date(deps.nowMs());
	const event = (userId: string | null, result: BillingEventResult) => ({ id: input.eventId, type: input.eventType, objectId: session.id, userId, result });
	if (session.status !== 'complete') {
		await deps.store.recordEvent({ event: event(null, 'ignored'), now });
		return 'ignored';
	}
	// A card setup has no client reference of its own: billing's tags name the seller, and the customer must be theirs.
	const customerId = session.customer ?? null;
	const userId = await accountOf(deps, session.metadata?.estori_user_id ?? null, customerId, session.client_reference_id ?? null);
	if (!userId || !customerId) {
		await deps.alert({ kind: 'billing-mismatch', subject: session.id, message: "A card change's account doesn't match its Stripe customer, so the card wasn't changed." });
		await deps.store.recordEvent({ event: event(null, 'refused'), now });
		return 'refused';
	}
	const intent = session.setup_intent;
	const cardId = typeof intent === 'object' && intent !== null ? intent.payment_method : null;
	if (!cardId) {
		logger.warn('A finished card setup does not say which card it saved', { sessionId: session.id });
		await deps.store.recordEvent({ event: event(userId, 'ignored'), now });
		return 'ignored';
	}
	const subscription = liveSubscription(await deps.store.subscriptionOf(userId));
	await setDefaultCard(deps.stripe, customerId, subscription?.stripeSubscriptionId ?? null, cardId);
	const recorded = await recordOnce(deps, { event: event(userId, 'applied'), now });
	return recorded === 'duplicate' ? 'duplicate' : 'applied';
}

/**
 * Copies the seller's stored agreement to the renewal terms onto the subscription, unless it already carries one. A
 * subscription that started with no stored agreement is recorded all the same, since it has been paid. The key rotates
 * with the bucket: Stripe replays a failed request under the same key, so a retry in a later bucket is a new request.
 */
async function stampConsent(deps: BillingEventDeps, sessionId: string, subscriptionId: string): Promise<void> {
	const consent = await deps.store.consentFor(sessionId);
	if (!consent) {
		logger.warn('A subscription started without a stored consent', { sessionId });
		return;
	}
	const subscription = await deps.stripe.retrieveSubscription(subscriptionId);
	if (subscription.metadata?.terms_version) return;
	await deps.stripe.updateSubscriptionMetadata(
		subscriptionId,
		{ terms_version: consent.termsVersion, renewal_consent_at: consent.createdAt.toISOString() },
		`billing-consent-${subscriptionId}-${idempotencyBucket(deps.nowMs())}`,
	);
}

export async function applyCreditPurchase(deps: BillingEventDeps, input: { eventId: string; eventType: string; sessionId: string }): Promise<BillingEventOutcome> {
	if (await deps.store.eventSeen(input.eventId)) return 'duplicate';
	const session = await deps.stripe.retrieveCheckoutSession(input.sessionId);
	const now = new Date(deps.nowMs());
	const event = (userId: string | null, result: BillingEventResult) => ({ id: input.eventId, type: input.eventType, objectId: session.id, userId, result });
	if (session.payment_status !== 'paid') {
		await deps.store.recordEvent({ event: event(null, 'ignored'), now });
		return 'ignored';
	}
	const metadata = session.metadata ?? {};
	const userId = await accountOf(deps, metadata.estori_user_id ?? null, session.customer ?? null, session.client_reference_id ?? null);
	const credits = Number(metadata.credits);
	const paymentIntentId = session.payment_intent;
	// Promotion codes are off for credits, so the amount paid is exactly the table's price.
	const matches = metadata.kind === CHECKOUT_KIND_CREDITS && isExtraCreditsAmount(credits) && session.amount_total === extraCreditsPriceCents(credits);
	if (!userId || !matches || !paymentIntentId) {
		await deps.alert({ kind: 'billing-mismatch', subject: session.id, message: "An extra-credits payment doesn't match its account or its price, so no credits were added. Refund it in Stripe." });
		await deps.store.recordEvent({ event: event(userId, 'refused'), now });
		return 'refused';
	}
	if (await deps.ledger.purchaseBySession(session.id)) {
		await deps.store.recordEvent({ event: event(userId, 'ignored'), now });
		return 'duplicate';
	}
	const amountCents = extraCreditsPriceCents(credits);
	const expiresAt = new Date(addMonths(now.getTime(), EXTRA_CREDITS.monthsValid));
	const notice: PlannedNotice = {
		key: `credits_receipt:${session.id}`,
		email: { kind: 'credits_receipt', credits, amountCents, expiresAt: expiresAt.getTime(), receiptNumber: paymentIntentId },
	};
	const recorded = await recordOnce(deps, {
		event: event(userId, 'applied'),
		purchase: { id: generateId(), userId, credits, amountCents, stripeCheckoutSessionId: session.id, stripePaymentIntentId: paymentIntentId, purchasedAt: now, expiresAt },
		notices: [{ key: notice.key, kind: notice.email.kind }],
		now,
	});
	if (recorded === 'duplicate') return 'duplicate';
	await deps.track(userId, [{ name: 'credits_purchased', properties: { credits, amount_cents: amountCents } }]);
	await notifyOrAlert(deps, userId, [notice]);
	return 'applied';
}

/**
 * A refunded extra-credits payment loses the refunded share of its unused credits. Usage up to now is settled first, so
 * credits already spent aren't counted as unused; the removal is worked out in the write from what's used then.
 * Null for a charge that isn't an extra-credits payment.
 */
export async function applyCreditRefund(deps: BillingEventDeps, input: { eventId: string; eventType: string; charge: StripeCharge }): Promise<BillingEventOutcome | null> {
	const { charge } = input;
	if (!charge.payment_intent) return null;
	const before = await deps.ledger.purchaseByPaymentIntent(charge.payment_intent);
	if (!before) return null;
	if (await deps.store.eventSeen(input.eventId)) return 'duplicate';
	const now = new Date(deps.nowMs());
	const event = (result: BillingEventResult) => ({ id: input.eventId, type: input.eventType, objectId: charge.id, userId: before.userId, result });
	if (charge.amount_refunded <= before.refundedCents || before.amountCents <= 0) {
		await deps.store.recordEvent({ event: event('ignored'), now });
		return 'ignored';
	}
	// A settle that races another run changes nothing, and the write below still counts from what's used when it lands.
	const account = await deps.account(before.userId, now.getTime());
	await deps.ledger.settle(before.userId, now.getTime(), { holdPeriodKey: heldPeriodKey(account) });
	const key = `credits_refunded:${charge.id}:${charge.amount_refunded}`;
	const recorded = await recordOnce(deps, {
		event: event('applied'),
		refund: { purchaseId: before.id, refundedCents: charge.amount_refunded },
		notices: [{ key, kind: 'credits_refunded' }],
		now,
	});
	if (recorded === 'duplicate') return 'duplicate';
	const after = (await deps.ledger.purchaseByPaymentIntent(charge.payment_intent)) ?? before;
	await notifyOrAlert(deps, before.userId, [
		{ key, email: { kind: 'credits_refunded', credits: Math.max(0, after.removedCredits - before.removedCredits), amountCents: charge.amount_refunded - before.refundedCents } },
	]);
	return 'applied';
}

/** Records a checkout as the seller returns from paying it, ahead of the webhook that carries the same payment. */
export interface CheckoutReturnRecorder {
	subscription(sessionId: string, subscriptionId: string, userId: string): Promise<void>;
	credits(sessionId: string): Promise<void>;
}

/**
 * Each return records under `return:{session}`, an id of its own, so the webhook's event isn't mistaken for it. The same
 * payment then reaches applySubscription or applyCreditPurchase twice, and what each already did makes the second a
 * no-op: a stored subscription row yields no new notices or events, and a purchase is unique by its session.
 */
export function checkoutReturnRecorders(deps: BillingEventDeps): CheckoutReturnRecorder {
	const eventType = 'checkout.return';
	return {
		subscription: async (sessionId, subscriptionId, userId) => {
			await applySubscription(deps, { eventId: `return:${sessionId}`, eventType, subscriptionId, expectedUserId: userId, invoice: null });
		},
		credits: async (sessionId) => {
			await applyCreditPurchase(deps, { eventId: `return:${sessionId}`, eventType, sessionId });
		},
	};
}

/** Billing's answer to a platform event; null when the event isn't billing's, so the webhook's other handlers take it. */
export async function handleBillingEvent(deps: BillingEventDeps, event: StripeEvent): Promise<BillingEventOutcome | null> {
	const object = event.data.object;
	const base = { eventId: event.id, eventType: event.type };
	switch (event.type) {
		case 'checkout.session.completed': {
			if (!isCheckoutSession(object)) return null;
			if (object.metadata?.kind === CHECKOUT_KIND_CREDITS) return applyCreditPurchase(deps, { ...base, sessionId: object.id });
			if (object.mode === 'setup' && object.metadata?.kind === CHECKOUT_KIND_CARD) return applyCardSetup(deps, { ...base, sessionId: object.id });
			if (object.mode === 'subscription' && typeof object.subscription === 'string') {
				const outcome = await applySubscription(deps, { ...base, subscriptionId: object.subscription, expectedUserId: object.client_reference_id ?? null, invoice: null });
				// A redelivery stamps too, so a stamp Stripe refused after the checkout was recorded is made on the retry.
				if (outcome === 'applied' || outcome === 'duplicate') await stampConsent(deps, object.id, object.subscription);
				return outcome;
			}
			return null;
		}
		case 'customer.subscription.created':
		case 'customer.subscription.updated':
		case 'customer.subscription.deleted':
			return hasStringId(object) ? applySubscription(deps, { ...base, subscriptionId: object.id, expectedUserId: null, invoice: null }) : null;
		case 'invoice.paid':
		case 'invoice.payment_failed':
		case 'invoice.payment_action_required': {
			if (!isStripeInvoice(object)) return null;
			const subscriptionId = invoiceSubscriptionId(object);
			return subscriptionId ? applySubscription(deps, { ...base, subscriptionId, expectedUserId: null, invoice: object }) : null;
		}
		case 'subscription_schedule.created':
		case 'subscription_schedule.updated':
		case 'subscription_schedule.released':
		case 'subscription_schedule.canceled': {
			if (!isStripeSchedule(object)) return null;
			const subscriptionId = object.subscription ?? object.released_subscription;
			return subscriptionId ? applySubscription(deps, { ...base, subscriptionId, expectedUserId: null, invoice: null }) : null;
		}
		case 'charge.refunded':
			return isStripeCharge(object) ? applyCreditRefund(deps, { ...base, charge: object }) : null;
		default:
			return null;
	}
}
