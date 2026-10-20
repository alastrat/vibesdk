/** Billing and subscriptions (spec 2026-10-19): the statuses, notice kinds and copy shared by the worker and the app. */

import { PLAN_PRICES_CENTS, formatUsd, planName, type PaidPlanId } from './plans';

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

/** What spent a credit use: the Think agent's steps, or an inference call outside it. */
export const CREDIT_USE_SOURCES = ['think', 'infer'] as const;
export type CreditUseSource = (typeof CREDIT_USE_SOURCES)[number];

export const BILLING_PATH = '/settings/billing';

/** Marks a Checkout session as an extra-credits purchase rather than a subscription. */
export const CHECKOUT_KIND_CREDITS = 'credits';

export const PLAN_LIMIT_ERROR_CODE = 'PLAN_LIMIT';

/** Shown above the pay button of a subscription checkout; the Terms say the same. */
export function renewalDisclosure(plan: PaidPlanId): string {
	return `${planName(plan)} renews every month at ${formatUsd(PLAN_PRICES_CENTS[plan])} until you cancel. Cancel any time in Estori; it ends at the end of the period.`;
}

/** Shown above the pay button of an extra-credits checkout. */
export const EXTRA_CREDITS_DISCLOSURE = 'Extra credits are used after your monthly credits and expire 12 months after purchase.';
