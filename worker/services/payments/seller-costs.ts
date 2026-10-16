/** What Stripe charges Estori for each seller account, passed to the seller (spec section 4). */

import type { PayoutInterval } from '../../../shared/types/store-payments';
import type { SellerLimitsSettings } from '../../../shared/types/seller-levels';

type SellerAccountCosts = SellerLimitsSettings['costs'];
const PAYOUTS_PER_MONTH: Readonly<Record<PayoutInterval, number>> = { daily: 22, weekly: 4, monthly: 1 };

export function payoutFeeCents(amountCents: number, costs: SellerAccountCosts): number {
	return Math.round((amountCents * costs.payoutPercent) / 100) + costs.payoutFixedCents;
}

export function chargesForPayout(input: { stripeAccountId: string; payoutId: string; amountCents: number; arrivalDate: Date }, costs: SellerAccountCosts) {
	const month = input.arrivalDate.toISOString().slice(0, 7);
	return [
		{ kind: 'payout-fee' as const, sourceId: input.payoutId, amountCents: payoutFeeCents(input.amountCents, costs) },
		{ kind: 'active-account-fee' as const, sourceId: `${input.stripeAccountId}-${month}`, amountCents: costs.monthlyActiveCents },
	];
}

export function estimatedMonthlyPayoutCostCents(monthlyVolumeCents: number, interval: PayoutInterval, costs: SellerAccountCosts): number {
	if (monthlyVolumeCents <= 0) return 0;
	const payouts = PAYOUTS_PER_MONTH[interval];
	return costs.monthlyActiveCents + Math.round((monthlyVolumeCents * costs.payoutPercent) / 100) + payouts * costs.payoutFixedCents;
}
