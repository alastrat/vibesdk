import { limitsFor, type SellerLevel, type SellerLimitsData, type SellerLimitsSettings, type SellerRecord } from '../../../../shared/types/seller-levels';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The stored level is what Stripe's payout delay matches; a pin shows as that level with no way up. */
export function limitsView(input: { record: SellerRecord; settings: SellerLimitsSettings; storedLevel: SellerLevel; weeklySalesUsedCents: number; nowMs: number }): SellerLimitsData {
	const level = input.settings.pinnedLevel ?? input.storedLevel;
	const limits = limitsFor(level, input.settings);
	const days = input.record.firstSaleAt ? Math.floor((input.nowMs - input.record.firstSaleAt.getTime()) / DAY_MS) : 0;
	return {
		level,
		...limits,
		weeklySalesUsedCents: input.weeklySalesUsedCents,
		nextLevel:
			level === 'established' || input.settings.pinnedLevel
				? null
				: { completedOrders: input.record.completedOrders, completedOrdersNeeded: input.settings.graduation.completedOrders, daysSinceFirstSale: days, daysNeeded: input.settings.graduation.daysSinceFirstSale },
	};
}
