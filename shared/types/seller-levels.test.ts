import { describe, expect, it } from 'vitest';
import { DEFAULT_SELLER_LIMITS, limitsFor, sellerLevelOf, weightedCartCents, type SellerRecord } from './seller-levels';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const GOOD: SellerRecord = { firstSaleAt: new Date(NOW - 30 * DAY), completedOrders: 10, ordersLast90Days: 200, disputesLast90Days: 1, lostDisputesLast90Days: 0 };

describe('sellerLevelOf', () => {
	it('makes a seller established at 30 days, 10 completed orders and disputes under 1%', () => {
		expect(sellerLevelOf(GOOD, DEFAULT_SELLER_LIMITS, NOW)).toBe('established');
	});

	it('keeps a seller new until every condition holds', () => {
		for (const record of [
			{ ...GOOD, firstSaleAt: new Date(NOW - 30 * DAY + 1) },
			{ ...GOOD, firstSaleAt: null },
			{ ...GOOD, completedOrders: 9 },
			{ ...GOOD, disputesLast90Days: 2 },
			{ ...GOOD, lostDisputesLast90Days: 1 },
		]) {
			expect(sellerLevelOf(record, DEFAULT_SELLER_LIMITS, NOW)).toBe('new');
		}
	});

	it('lets an admin pin a level either way', () => {
		expect(sellerLevelOf({ ...GOOD, completedOrders: 0 }, { ...DEFAULT_SELLER_LIMITS, pinnedLevel: 'established' }, NOW)).toBe('established');
		expect(sellerLevelOf(GOOD, { ...DEFAULT_SELLER_LIMITS, pinnedLevel: 'new' }, NOW)).toBe('new');
	});
});

describe('limitsFor', () => {
	it("gives each level its limits, with a seller's own numbers on top", () => {
		expect(limitsFor('new', DEFAULT_SELLER_LIMITS)).toEqual({ largestOrderCents: 15_000, weeklySalesCents: 50_000, payoutDelayDays: 10 });
		expect(limitsFor('established', DEFAULT_SELLER_LIMITS)).toEqual({ largestOrderCents: 50_000, weeklySalesCents: 500_000, payoutDelayDays: 5 });
		const custom = { ...DEFAULT_SELLER_LIMITS, overrides: { largestOrderCents: 30_000, weeklySalesCents: null, payoutDelayDays: null } };
		expect(limitsFor('new', custom)).toEqual({ largestOrderCents: 30_000, weeklySalesCents: 50_000, payoutDelayDays: 10 });
	});
});

describe('weightedCartCents', () => {
	it("counts the seller's own lines twice, and catalog lines and shipping once", () => {
		const cart = {
			totalCents: 7099,
			lines: [
				{ kind: 'catalog' as const, unitPriceCents: 4099, quantity: 1 },
				{ kind: 'own' as const, unitPriceCents: 1000, quantity: 2 },
			],
		};
		expect(weightedCartCents(cart)).toBe(9099);
	});
});
