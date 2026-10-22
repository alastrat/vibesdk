import {
	PLAN_LIMITS,
	planPriceCents,
	type BillingInterval,
	type PaidPlanId,
} from '../../../shared/types/plans';
import type { StripeClient, StripePrice } from '../payments/stripe-client';
import {
	planOfPrice,
	creditsOfPrice,
	matchesPlanPrice,
	priceIdFor,
	type StripePriceIds,
} from './prices';

/** A shared recurring price for this plan/allowance, created only from server-side amounts. */
export async function recurringPriceId(
	stripe: Pick<
		StripeClient,
		'retrievePrice' | 'findPlanPrice' | 'createPlanPrice'
	>,
	ids: StripePriceIds,
	plan: PaidPlanId,
	interval: BillingInterval,
	credits: number,
): Promise<string | null> {
	const baseId = priceIdFor(ids, plan, interval);
	if (!baseId) return null;
	if (credits === PLAN_LIMITS[plan].aiCredits) return baseId;
	const base = await stripe.retrievePrice(baseId);
	if (!matchesPlanPrice(base, plan, interval)) return null;
	const productId =
		typeof base.product === 'string' ? base.product : base.product?.id;
	if (!productId) return null;
	const priceCents = planPriceCents(plan, interval, credits);
	const productHash = Array.from(
		new Uint8Array(
			await crypto.subtle.digest(
				'SHA-256',
				new TextEncoder().encode(productId),
			),
		),
		(byte) => byte.toString(16).padStart(2, '0'),
	).join('');
	const lookupKey = `estori_${plan}_${interval}_${credits}_${priceCents}_${productHash}`;
	const sameProduct = (price: StripePrice): boolean =>
		(typeof price.product === 'string'
			? price.product
			: price.product?.id) === productId;
	const existing = await stripe.findPlanPrice(lookupKey);
	if (existing)
		return sameProduct(existing) &&
			planOfPrice(existing, null) === plan &&
			creditsOfPrice(existing, plan, interval) === credits &&
			matchesPlanPrice(existing, plan, interval, credits)
			? existing.id
			: null;
	const made = await stripe.createPlanPrice({
		productId,
		plan,
		interval,
		monthlyCredits: credits,
		priceCents,
		lookupKey,
	});
	return sameProduct(made) &&
		planOfPrice(made, null) === plan &&
		creditsOfPrice(made, plan, interval) === credits &&
		matchesPlanPrice(made, plan, interval, credits)
		? made.id
		: null;
}
