/** The Stripe prices behind Estori's plans and extra credits, read from STRIPE_PRICE_IDS. */

import { isPaidPlanId, type PaidPlanId } from '../../../shared/types/plans';
import type { StripePrice } from '../payments/stripe-client';

export interface StripePriceIds {
	pro: string;
	premium: string;
	credits: string;
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
	const { pro, premium, credits } = parsed as Record<string, unknown>;
	if (!isPriceId(pro) || !isPriceId(premium) || !isPriceId(credits)) return null;
	return { pro, premium, credits };
}

/** A price's plan: from the configured ids first, then from the plan tag on the price, which covers a price replaced since. */
export function planOfPrice(price: Pick<StripePrice, 'id' | 'metadata'>, ids: StripePriceIds | null): PaidPlanId | null {
	if (ids?.pro === price.id) return 'pro';
	if (ids?.premium === price.id) return 'premium';
	const tagged = price.metadata?.estori_plan;
	return isPaidPlanId(tagged) ? tagged : null;
}
