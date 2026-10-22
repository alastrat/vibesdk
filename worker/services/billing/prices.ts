/** The Stripe prices behind Estori's plans and extra credits, read from STRIPE_PRICE_IDS. */

import { PLAN_LIMITS, isPlanCreditAmount, planPriceCents, isPaidPlanId, type BillingInterval, type PaidPlanId } from '../../../shared/types/plans';
import type { StripePrice } from '../payments/stripe-client';

export interface StripePriceIds {
	pro: string;
	premium: string;
	credits: string;
	proYearly?: string;
	premiumYearly?: string;
}

function isPriceId(value: unknown): value is string {
	return typeof value === 'string' && value.startsWith('price_');
}

/** The three price ids from a JSON value such as `{"pro":"price_...","premium":"price_...","credits":"price_..."}`, or null when any is missing or malformed. */
export function stripePriceIds(value: string | undefined): StripePriceIds | null {
	if (!value) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return null;
	}
	if (typeof parsed !== 'object' || parsed === null) return null;
	const { pro, premium, credits, proYearly, premiumYearly } = parsed as Record<string, unknown>;
	if (!isPriceId(pro) || !isPriceId(premium) || !isPriceId(credits)) return null;
	if ((proYearly !== undefined && !isPriceId(proYearly)) || (premiumYearly !== undefined && !isPriceId(premiumYearly))) return null;
	return { pro, premium, credits, ...(isPriceId(proYearly) ? { proYearly } : {}), ...(isPriceId(premiumYearly) ? { premiumYearly } : {}) };
}

/** A price's plan: from the configured ids first, then from the plan tag on the price, which covers a price replaced since. */
export function planOfPrice(price: Pick<StripePrice, 'id' | 'metadata'>, ids: StripePriceIds | null): PaidPlanId | null {
	if (ids?.pro === price.id || ids?.proYearly === price.id) return 'pro';
	if (ids?.premium === price.id || ids?.premiumYearly === price.id) return 'premium';
	const tagged = price.metadata?.estori_plan;
	return isPaidPlanId(tagged) ? tagged : null;
}

/** Missing annual IDs never fall back to a monthly charge. */
export function priceIdFor(ids: StripePriceIds, plan: PaidPlanId, interval: BillingInterval): string | null {
	return interval === 'year' ? (ids[plan === 'pro' ? 'proYearly' : 'premiumYearly'] ?? null) : ids[plan];
}

/** Prefer Stripe's recurring price, preserving metadata/config fallback for retired prices and older clients. */
export function intervalOfPrice(price: StripePrice, ids: StripePriceIds | null): BillingInterval | null {
	if (price.recurring) {
		if ((price.recurring.interval_count ?? 1) !== 1) return null;
		return price.recurring.interval === 'month' || price.recurring.interval === 'year' ? price.recurring.interval : null;
	}
	if (ids?.proYearly === price.id || ids?.premiumYearly === price.id) return 'year';
	const tagged = price.metadata?.estori_billing_interval;
	if (tagged !== undefined) return tagged === 'month' || tagged === 'year' ? tagged : null;
	return planOfPrice(price, ids) === null ? null : 'month';
}

export function matchesPlanPrice(price: StripePrice | null | undefined, plan: PaidPlanId, interval: BillingInterval, credits: number = PLAN_LIMITS[plan].aiCredits): boolean {
 return price?.currency === 'usd' && price.unit_amount === planPriceCents(plan, interval, credits) && price.recurring?.interval === interval && (price.recurring.interval_count ?? 1) === 1;
}
export function matchesYearlyPrice(price: StripePrice | null | undefined, plan: PaidPlanId): boolean { return matchesPlanPrice(price, plan, 'year'); }
/** null marks the standard allowance. Invalid custom metadata must not grant credits. */
export function creditsOfPrice(price: StripePrice, plan: PaidPlanId, interval: BillingInterval): number | null | 'invalid' {
 const raw = price.metadata?.estori_monthly_credits;
 if (raw === undefined) return null;
 const amount = Number(raw);
 if (String(amount) !== raw || !isPlanCreditAmount(plan, amount) || !matchesPlanPrice(price, plan, interval, amount)) return 'invalid';
 return amount === PLAN_LIMITS[plan].aiCredits ? null : amount;
}
