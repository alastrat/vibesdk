import { matchesPlanPrice } from './prices';
/** What billing reads from a Checkout session: its state, what it sells, and the renewal terms its promotion code sets. Pure. */

import {
	CHECKOUT_KIND_CREDITS,
	renewalDisclosure,
	subscribeButtonText,
	subscriptionConsentText,
	type CheckoutOrder,
	type CheckoutSessionState,
	type CheckoutTermsView,
	type PromotionTerms,
} from '../../../shared/types/billing';
import {
	PLAN_LIMITS,
	isPlanCreditAmount,
	planPriceCents,
	isBillingInterval,
	type BillingInterval,
	extraCreditsPriceCents,
	formatCredits,
	isPaidPlanId,
	limitFeatures,
	type PaidPlanId,
} from '../../../shared/types/plans';
import type { Translator } from '../../../shared/i18n/translate';
import type { StripeCheckoutSession, StripeCoupon } from '../payments/stripe-client';

/** A discount whose terms can't be stated exactly. The checkout refuses it: consent never shows a guessed price or month count. */
export class UnreadablePromotionError extends Error {
	constructor(
		readonly couponId: string,
		reason: string,
	) {
		super(`The promotion on a checkout can't be read: ${reason}`);
		this.name = 'UnreadablePromotionError';
	}
}

export class UnreadablePriceError extends Error {
	constructor() {
		super('The yearly price does not match the advertised annual amount and billing interval.');
	}
}

type Discount = NonNullable<StripeCheckoutSession['discounts']>[number];

function isExpandedCoupon(value: StripeCoupon | string | null | undefined): value is StripeCoupon {
	return typeof value === 'object' && value !== null;
}

/** The coupon of a discount, from the discount itself or from the promotion code that applied it. */
function couponOf(discount: Discount): StripeCoupon {
	const code = typeof discount.promotion_code === 'object' && discount.promotion_code !== null ? discount.promotion_code : null;
	for (const candidate of [discount.coupon, code?.promotion.coupon]) {
		if (isExpandedCoupon(candidate)) return candidate;
	}
	const named = [discount.coupon, code?.promotion.coupon, code?.id, discount.promotion_code].find((value): value is string => typeof value === 'string');
	throw new UnreadablePromotionError(named ?? 'unknown', 'the coupon was not returned');
}

/**
 * What the first discount does to the price, with `discountedCents` the session's own total. Null without a discount.
 * Throws for a discount it can't state exactly, which the action turns into a refusal.
 */
export function promotionTermsOf(session: StripeCheckoutSession): PromotionTerms | null {
	const discount = session.discounts?.[0];
	if (!discount) return null;
	const coupon = couponOf(discount);
	if (session.amount_total === null) throw new UnreadablePromotionError(coupon.id, 'the session has no total');
	if (coupon.duration === 'repeating' && coupon.duration_in_months === null) throw new UnreadablePromotionError(coupon.id, 'a repeating coupon has no month count');
	return { duration: coupon.duration, durationInMonths: coupon.duration === 'repeating' ? coupon.duration_in_months : null, discountedCents: session.amount_total };
}

export function sessionStateOf(session: StripeCheckoutSession): CheckoutSessionState {
	if (session.status === 'complete') return session.payment_status === 'unpaid' ? 'processing' : 'paid';
	return session.status === 'expired' ? 'expired' : 'open';
}

/** The plan a subscription session was made for, or that it sells extra credits; null for any other session. */
export function billingSessionOf(session: StripeCheckoutSession): { kind: 'plan'; plan: PaidPlanId; billingInterval?: BillingInterval; monthlyCredits?: number } | { kind: 'credits' } | null {
	if (session.metadata?.kind === CHECKOUT_KIND_CREDITS) return { kind: 'credits' };
	const plan = session.metadata?.plan;
	const interval = session.metadata?.billing_interval;
	const rawCredits = session.metadata?.monthly_credits;
	const monthlyCredits = rawCredits === undefined ? undefined : Number(rawCredits);
	if (rawCredits !== undefined && (!isPaidPlanId(plan) || !isPlanCreditAmount(plan, monthlyCredits) || String(monthlyCredits) !== rawCredits)) return null;
	if (interval !== undefined && !isBillingInterval(interval)) return null;
	return session.mode === 'subscription' && isPaidPlanId(plan) ? { kind: 'plan', plan, ...(interval === 'year' ? { billingInterval: interval } : {}), ...(monthlyCredits !== undefined ? { monthlyCredits } : {}) } : null;
}

/** What a plan sells, its lines worded in the seller's language. */
export function planOrder(plan: PaidPlanId, i18n: Translator, interval: BillingInterval = 'month', monthlyCredits: number = PLAN_LIMITS[plan].aiCredits): CheckoutOrder {
	const credits = i18n.t('{credits} AI credits a month', { credits: formatCredits(monthlyCredits, i18n.locale) });
	return {
		kind: 'plan',
		plan,
		...(interval === 'year' ? { billingInterval: interval } : {}),
		...(monthlyCredits !== PLAN_LIMITS[plan].aiCredits ? { monthlyCredits } : {}),
		priceCents: planPriceCents(plan, interval, monthlyCredits),
		includes: [credits, ...limitFeatures(plan, undefined, i18n)],
	};
}

export function creditsOrder(credits: number): CheckoutOrder {
	return { kind: 'credits', credits, amountCents: extraCreditsPriceCents(credits) };
}

/** The consent sentence, button, small print and first payment for a plan session, following its promotion code, worded in the seller's language. Throws as `promotionTermsOf` does. */
export function termsViewOf(plan: PaidPlanId, session: StripeCheckoutSession, i18n: Translator): CheckoutTermsView {
	const promotion = promotionTermsOf(session);
	const interval = billingSessionOf(session);
	const billingInterval = interval?.kind === 'plan' ? (interval.billingInterval ?? 'month') : 'month';
	const monthlyCredits = interval?.kind === 'plan' ? interval.monthlyCredits : undefined;
	if (billingInterval === 'year' || monthlyCredits !== undefined) {
		const lines = session.line_items?.data;
		const line = lines?.[0];
		const price = line?.price;
		if (lines?.length !== 1 || line?.quantity !== 1 || !matchesPlanPrice(price, plan, billingInterval, monthlyCredits)) throw new UnreadablePriceError();
	}

	return {
		consentText: subscriptionConsentText(plan, promotion, i18n, billingInterval, monthlyCredits),
		buttonText: subscribeButtonText(plan, promotion, i18n, billingInterval, monthlyCredits),
		dueTodayCents: promotion ? promotion.discountedCents : (session.amount_total ?? planPriceCents(plan, billingInterval, monthlyCredits)),
		disclosure: renewalDisclosure(plan, promotion, i18n, billingInterval, monthlyCredits),
	};
}
