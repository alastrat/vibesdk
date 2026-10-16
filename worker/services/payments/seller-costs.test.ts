import { describe, expect, it } from 'vitest';
import { chargesForPayout, estimatedMonthlyPayoutCostCents, payoutFeeCents } from './seller-costs';
import { DEFAULT_SELLER_LIMITS } from '../../../shared/types/seller-levels';

describe("Stripe's seller account costs", () => {
	it('charges 0.25% plus 25 cents per payout, rounded to the cent', () => {
		expect(payoutFeeCents(100_000, DEFAULT_SELLER_LIMITS.costs)).toBe(275);
		expect(payoutFeeCents(1_999, DEFAULT_SELLER_LIMITS.costs)).toBe(30);
	});

	it('charges the monthly fee once per account per calendar month, keyed so redeliveries charge once', () => {
		expect(chargesForPayout({ stripeAccountId: 'acct_1', payoutId: 'po_1', amountCents: 100_000, arrivalDate: new Date('2026-10-19T00:00:00Z') }, DEFAULT_SELLER_LIMITS.costs)).toEqual([
			{ kind: 'payout-fee', sourceId: 'po_1', amountCents: 275 },
			{ kind: 'active-account-fee', sourceId: 'acct_1-2026-10', amountCents: 200 },
		]);
	});

	it('estimates a month of payouts by frequency', () => {
		expect(estimatedMonthlyPayoutCostCents(100_000, 'daily', DEFAULT_SELLER_LIMITS.costs)).toBe(1000);
		expect(estimatedMonthlyPayoutCostCents(100_000, 'weekly', DEFAULT_SELLER_LIMITS.costs)).toBe(550);
		expect(estimatedMonthlyPayoutCostCents(100_000, 'monthly', DEFAULT_SELLER_LIMITS.costs)).toBe(475);
		expect(estimatedMonthlyPayoutCostCents(0, 'weekly', DEFAULT_SELLER_LIMITS.costs)).toBe(0);
	});

	it("uses Stripe's rates from settings, so a price change needs no code change", () => {
		expect(chargesForPayout({ stripeAccountId: 'acct_1', payoutId: 'po_1', amountCents: 100_000, arrivalDate: new Date('2026-10-19T00:00:00Z') }, { monthlyActiveCents: 300, payoutPercent: 0.5, payoutFixedCents: 30 })).toEqual([
			{ kind: 'payout-fee', sourceId: 'po_1', amountCents: 530 },
			{ kind: 'active-account-fee', sourceId: 'acct_1-2026-10', amountCents: 300 },
		]);
	});
});
