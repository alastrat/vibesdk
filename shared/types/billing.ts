/** Billing and subscriptions (spec 2026-10-19): the statuses, notice kinds and copy shared by the worker and the app. */

import { PLAN_PRICES_CENTS, formatUsd, planName, type PaidPlanId, type PlanId, type PlanLimitOverrides, type PlanLimits } from './plans';

/** Stripe's subscription statuses. */
export const SUBSCRIPTION_STATUSES = ['incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** The statuses that still hold a plan: a failing payment keeps it through the grace period. */
export const LIVE_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = ['active', 'trialing', 'past_due'];

export const BILLING_EVENT_RESULTS = ['applied', 'ignored', 'refused'] as const;
export type BillingEventResult = (typeof BILLING_EVENT_RESULTS)[number];

/** The emails and in-app notices billing sends; each is recorded once under its key. */
export const BILLING_NOTICE_KINDS = [
	'plan_started',
	'receipt',
	'plan_upgraded',
	'downgrade_scheduled',
	'payment_failed',
	'plan_ending',
	'plan_ended',
	'credits_renewed',
	'credits_20',
	'credits_5',
	'credits_receipt',
	'credits_refunded',
	'enforcement_notice',
] as const;
export type BillingNoticeKind = (typeof BILLING_NOTICE_KINDS)[number];

/** Where an account's plan comes from: nothing paid, a Stripe subscription, or an admin's override. */
export type BillingSource = 'free' | 'subscription' | 'override';

/** What spent a credit use: the Think agent's steps, or an inference call outside it. */
export const CREDIT_USE_SOURCES = ['think', 'infer'] as const;
export type CreditUseSource = (typeof CREDIT_USE_SOURCES)[number];

export const BILLING_PATH = '/settings/billing';

/** Marks a Checkout session as an extra-credits purchase rather than a subscription. */
export const CHECKOUT_KIND_CREDITS = 'credits';

/** Marks a Checkout session as a card setup rather than a payment. */
export const CHECKOUT_KIND_CARD = 'card';

export const PLAN_LIMIT_ERROR_CODE = 'PLAN_LIMIT';

/** SpaceDO's answer to a publish that adds catalog products for an account without the catalog. Mirrored in space/src/space/store-manifest.ts. */
export const NEW_CATALOG_PRODUCTS_ERROR = 'This version adds catalog products, which need Pro or Premium.';

/** Shown above the pay button of an extra-credits checkout. */
export const EXTRA_CREDITS_DISCLOSURE = 'Extra credits are used after your monthly credits and expire 12 months after purchase.';

/** The answer to a billing action from an account outside the billing flag. */
export const BILLING_NOT_OPEN_MESSAGE = "Plans aren't open for your account yet.";

/** The answer to a billing action while Stripe's publishable key isn't configured. */
export const PAYMENTS_NOT_SET_UP_MESSAGE = "Payments aren't set up yet.";

/** Shown when a checkout session has closed before the seller paid. */
export const CHECKOUT_EXPIRED_MESSAGE = 'This checkout timed out.';

/** What a promotion code does to a subscription's price, as Stripe's coupon reports it. `discountedCents` is the discounted monthly price, or the first payment for `once`. */
export interface PromotionTerms {
	duration: 'once' | 'repeating' | 'forever';
	/** Set for `repeating`, null otherwise. */
	durationInMonths: number | null;
	discountedCents: number;
}

/** What the promotion charges while it lasts, such as "$24.50 today" or "$24.50 a month for 3 months". */
function discountedPhrase(promotion: PromotionTerms): string {
	const discounted = formatUsd(promotion.discountedCents);
	switch (promotion.duration) {
		case 'once':
			return `${discounted} today`;
		case 'repeating': {
			// Stripe always sends a month count for a repeating coupon; consent text must never guess it.
			if (promotion.durationInMonths === null) throw new Error('A repeating promotion needs a month count.');
			const months = promotion.durationInMonths;
			return `${discounted} a month for ${months} ${months === 1 ? 'month' : 'months'}`;
		}
		case 'forever':
			return `${discounted} a month`;
	}
}

/** What the seller pays and when, such as "$24.50 today, then $49 a month". */
export function renewalTermsPhrase(plan: PaidPlanId, promotion: PromotionTerms | null): string {
	const price = `${formatUsd(PLAN_PRICES_CENTS[plan])} a month`;
	if (!promotion) return price;
	return promotion.duration === 'forever' ? discountedPhrase(promotion) : `${discountedPhrase(promotion)}, then ${price}`;
}

const CANCEL_NOTE = 'Cancel any time in Estori; it ends at the end of the period.';

/**
 * Shown above the pay button of a subscription checkout, from the same promotion as the consent; the Terms say the same.
 * A forever code renews at the discounted price, and any other code states its price before the plain renewal.
 */
export function renewalDisclosure(plan: PaidPlanId, promotion: PromotionTerms | null): string {
	const name = planName(plan);
	const renews = (cents: number) => `renews every month at ${formatUsd(cents)} until you cancel. ${CANCEL_NOTE}`;
	if (!promotion) return `${name} ${renews(PLAN_PRICES_CENTS[plan])}`;
	if (promotion.duration === 'forever') return `${name} ${renews(promotion.discountedCents)}`;
	return `${name} costs ${discountedPhrase(promotion)}, then ${renews(PLAN_PRICES_CENTS[plan])}`;
}

/** The sentence the seller agrees to beside the Subscribe button; the page links "Terms" to /terms. */
export function subscriptionConsentText(plan: PaidPlanId, promotion: PromotionTerms | null): string {
	const phrase = renewalTermsPhrase(plan, promotion);
	return promotion
		? `I agree to the Terms, and that Estori ${planName(plan)} costs ${phrase}, until I cancel.`
		: `I agree to the Terms, and that Estori ${planName(plan)} renews at ${phrase} until I cancel.`;
}

export function subscribeButtonText(plan: PaidPlanId, promotion: PromotionTerms | null): string {
	return `Subscribe: ${renewalTermsPhrase(plan, promotion)}`;
}

/** What a checkout page sells: a plan with what it includes, or extra credits. */
export type CheckoutOrder =
	| { kind: 'plan'; plan: PaidPlanId; priceCents: number; includes: string[] }
	| { kind: 'credits'; credits: number; amountCents: number };

/** The consent sentence, button and small print the subscription checkout shows, and what the first payment is. */
export interface CheckoutTermsView {
	consentText: string;
	buttonText: string;
	dueTodayCents: number;
	/** The renewal the small print by the button states, worded from the same promotion as the consent. */
	disclosure: string;
}

/** POST answer that opens an embedded checkout; `terms` is null for credits, which have no renewal. */
export interface CheckoutClientStart {
	clientSecret: string;
	publishableKey: string;
	sessionId: string;
	order: CheckoutOrder;
	terms: CheckoutTermsView | null;
}

/** The seller's agreement to the terms shown, sent before the payment is confirmed. */
export interface CheckoutConsentRequest {
	sessionId: string;
	termsVersion: string;
	consentText: string;
}

export type CheckoutSessionState = 'paid' | 'processing' | 'open' | 'expired';

export interface CheckoutStatusView {
	state: CheckoutSessionState;
	kind: 'plan' | 'credits';
}

/** `save` keeps a card for the next invoice; `pay` also pays the invoice that failed. */
export type CardSetupMode = 'save' | 'pay';

export interface CardSetupStart {
	clientSecret: string;
	publishableKey: string;
	sessionId: string;
	mode: CardSetupMode;
}

/** What happened when a saved card was used on an invoice; `requires_action` carries what Stripe.js needs to finish the bank's confirmation. */
export type InvoicePaymentResult =
	| { state: 'paid' }
	| { state: 'saved' }
	| { state: 'nothing_due' }
	| { state: 'requires_action'; clientSecret: string; publishableKey: string }
	| { state: 'declined'; message: string };

/** The card a subscription renews on; never more than Stripe's display fields. */
export interface CardOnFile {
	brand: string;
	last4: string;
	expMonth: number;
	expYear: number;
}

/** The billing history lists this many invoices, newest first. */
export const BILLING_HISTORY_LIMIT = 24;

/** One invoice in the billing history; `date` is in ms. */
export interface InvoiceView {
	id: string;
	date: number;
	description: string;
	amountCents: number;
	currency: string;
	status: 'paid' | 'open' | 'void' | 'uncollectible';
}

/** This period's AI credits on the billing page; `renewsAt` is when the period ends, in ms. */
export interface BillingCreditsView {
	pool: number;
	granted: number;
	used: number;
	left: number;
	/** Extra credits left once this period's overrun is paid from them. */
	purchasedLeft: number;
	available: number;
	renewsAt: number;
}

/** An extra-credits purchase that still has credits left; times in ms. */
export interface PurchaseView {
	credits: number;
	left: number;
	purchasedAt: number;
	expiresAt: number;
}

/** GET /api/billing: the account's plan, its subscription as Stripe last reported it, this period's credits, and what it may do. Times in ms. */
export interface BillingView {
	/** False while the account is outside the billing flag; nothing below is enforced then. */
	enabled: boolean;
	plan: PlanId;
	source: BillingSource;
	status: SubscriptionStatus | null;
	periodStart: number;
	periodEnd: number;
	cancelAtPeriodEnd: boolean;
	pendingPlan: PaidPlanId | null;
	pendingPlanAt: number | null;
	graceEndsAt: number | null;
	paymentFailing: boolean;
	credits: BillingCreditsView | null;
	alert: 'credits_20' | 'credits_5' | null;
	purchases: PurchaseView[];
	limits: PlanLimits;
	canManageBilling: boolean;
	canBuyCredits: boolean;
	/** The card on file, or null when there is none. */
	card: CardOnFile | null;
}

/** Stripe took the change; the page shows it once the webhook records it. */
export interface BillingChangeRequested {
	requested: true;
}

export interface PlanRequest {
	plan: PaidPlanId;
}

export interface CreditsRequest {
	credits: number;
}

/** An admin's read of one account: its billing page, the override that rules it, this period's grants, and the Stripe pages for it. Times in ms. */
export type AdminBillingView = BillingView & {
	userId: string;
	override: { plan: PlanId | null; limits: PlanLimitOverrides; until: number | null; reason: string; createdAt: number } | null;
	grants: Array<{ credits: number; reason: string; createdAt: number }>;
	stripeCustomerUrl: string | null;
	stripeSubscriptionUrl: string | null;
};

/** `until` is an ISO date in the future; a null plan ends the account's override. */
export interface PlanOverrideRequest {
	plan: PlanId | null;
	limits?: PlanLimitOverrides;
	until?: string | null;
	reason: string;
}

export interface CreditGrantRequest {
	credits: number;
	reason: string;
}
