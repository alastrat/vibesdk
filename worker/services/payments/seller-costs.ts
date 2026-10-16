/** What Stripe charges Estori for each seller account, passed to the seller (spec section 4). */

import type { PayoutInterval } from '../../../shared/types/store-payments';

export const SELLER_ACCOUNT_COSTS = { monthlyActiveCents: 200, payoutPercent: 0.25, payoutFixedCents: 25 } as const;
const PAYOUTS_PER_MONTH: Readonly<Record<PayoutInterval, number>> = { daily: 22, weekly: 4, monthly: 1 };

export function payoutFeeCents(amountCents: number): number {
	return Math.round((amountCents * SELLER_ACCOUNT_COSTS.payoutPercent) / 100) + SELLER_ACCOUNT_COSTS.payoutFixedCents;
}

export function chargesForPayout(input: { stripeAccountId: string; payoutId: string; amountCents: number; arrivalDate: Date }) {
	const month = input.arrivalDate.toISOString().slice(0, 7);
	return [
		{ kind: 'payout-fee' as const, sourceId: input.payoutId, amountCents: payoutFeeCents(input.amountCents) },
		{ kind: 'active-account-fee' as const, sourceId: `${input.stripeAccountId}-${month}`, amountCents: SELLER_ACCOUNT_COSTS.monthlyActiveCents },
	];
}

export function estimatedMonthlyPayoutCostCents(monthlyVolumeCents: number, interval: PayoutInterval): number {
	if (monthlyVolumeCents <= 0) return 0;
	const payouts = PAYOUTS_PER_MONTH[interval];
	return SELLER_ACCOUNT_COSTS.monthlyActiveCents + Math.round((monthlyVolumeCents * SELLER_ACCOUNT_COSTS.payoutPercent) / 100) + payouts * SELLER_ACCOUNT_COSTS.payoutFixedCents;
}
