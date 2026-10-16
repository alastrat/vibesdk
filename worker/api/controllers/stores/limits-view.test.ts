import { describe, expect, it } from 'vitest';
import { limitsView } from './limits-view';
import { DEFAULT_SELLER_LIMITS } from '../../../../shared/types/seller-levels';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe('limitsView', () => {
	it("shows a new seller's limits, this week's use, and what's left to reach Established", () => {
		const view = limitsView({ record: { firstSaleAt: new Date(NOW - 12 * DAY), completedOrders: 4, ordersLast90Days: 6, disputesLast90Days: 0, lostDisputesLast90Days: 0 }, settings: DEFAULT_SELLER_LIMITS, storedLevel: 'new', weeklySalesUsedCents: 12_000, nowMs: NOW });
		expect(view).toEqual({
			level: 'new',
			largestOrderCents: 15_000,
			weeklySalesCents: 50_000,
			weeklySalesUsedCents: 12_000,
			payoutDelayDays: 10,
			nextLevel: { completedOrders: 4, completedOrdersNeeded: 10, daysSinceFirstSale: 12, daysNeeded: 30 },
		});
	});

	it('has no next level for an established seller, or for a pinned one', () => {
		const record = { firstSaleAt: new Date(NOW - 90 * DAY), completedOrders: 40, ordersLast90Days: 40, disputesLast90Days: 0, lostDisputesLast90Days: 0 };
		expect(limitsView({ record, settings: DEFAULT_SELLER_LIMITS, storedLevel: 'established', weeklySalesUsedCents: 0, nowMs: NOW }).nextLevel).toBeNull();
		expect(limitsView({ record: { ...record, completedOrders: 0 }, settings: { ...DEFAULT_SELLER_LIMITS, pinnedLevel: 'new' }, storedLevel: 'new', weeklySalesUsedCents: 0, nowMs: NOW }).nextLevel).toBeNull();
	});
});
