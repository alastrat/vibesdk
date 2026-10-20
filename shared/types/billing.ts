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

export const PLAN_LIMIT_ERROR_CODE = 'PLAN_LIMIT';

/** SpaceDO's answer to a publish that adds catalog products for an account without the catalog. Mirrored in space/src/space/store-manifest.ts. */
export const NEW_CATALOG_PRODUCTS_ERROR = 'This version adds catalog products, which need Pro or Premium.';

/** Shown above the pay button of a subscription checkout; the Terms say the same. */
export function renewalDisclosure(plan: PaidPlanId): string {
	return `${planName(plan)} renews every month at ${formatUsd(PLAN_PRICES_CENTS[plan])} until you cancel. Cancel any time in Estori; it ends at the end of the period.`;
}

/** Shown above the pay button of an extra-credits checkout. */
export const EXTRA_CREDITS_DISCLOSURE = 'Extra credits are used after your monthly credits and expire 12 months after purchase.';

/** The answer to a billing action from an account outside the billing flag. */
export const BILLING_NOT_OPEN_MESSAGE = "Plans aren't open for your account yet.";

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
}

export interface CheckoutStarted {
	url: string;
	sessionId: string;
}

export interface BillingRedirect {
	url: string;
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
