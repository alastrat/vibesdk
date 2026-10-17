import type { SellerAccountCosts } from '@/api-types';

function money(cents: number): string {
	return cents < 100 ? `${cents}\u00a2` : `$${(cents / 100).toFixed(2)}`;
}

/** Stripe's account and payout fees in words, for a seller with no sales to estimate from yet. */
export function stripeFeesText(costs: SellerAccountCosts): string {
	return `${money(costs.monthlyActiveCents)} a month in Stripe fees, plus ${costs.payoutPercent}% and ${money(costs.payoutFixedCents)} per payout, once you're paid`;
}
