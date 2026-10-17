/** Seller levels: how large a store's orders and weekly sales can be, and how long its payouts wait (spec section 4). */

export const SELLER_LEVELS = ['new', 'established'] as const;
export type SellerLevel = (typeof SELLER_LEVELS)[number];

export interface SellerLevelLimits {
	largestOrderCents: number;
	weeklySalesCents: number;
	/** Business days in the US. */
	payoutDelayDays: number;
}

export interface SellerLimitsSettings {
	levels: Record<SellerLevel, SellerLevelLimits>;
	graduation: { daysSinceFirstSale: number; completedOrders: number; maxDisputeRatePercent: number };
	/** Stripe's charges for each seller account, passed to the seller. */
	costs: { monthlyActiveCents: number; payoutPercent: number; payoutFixedCents: number };
	/** Set per seller by an admin: this level, whatever the record says. */
	pinnedLevel: SellerLevel | null;
	/** Set per seller by an admin: numbers that replace the level's; null keeps the level's. */
	overrides: { largestOrderCents: number | null; weeklySalesCents: number | null; payoutDelayDays: number | null };
}

/** Stripe's charges for each seller account, passed to the seller. */
export type SellerAccountCosts = SellerLimitsSettings['costs'];

export const DEFAULT_SELLER_LIMITS: SellerLimitsSettings = {
	levels: {
		new: { largestOrderCents: 15_000, weeklySalesCents: 50_000, payoutDelayDays: 10 },
		established: { largestOrderCents: 50_000, weeklySalesCents: 500_000, payoutDelayDays: 5 },
	},
	graduation: { daysSinceFirstSale: 30, completedOrders: 10, maxDisputeRatePercent: 1 },
	costs: { monthlyActiveCents: 200, payoutPercent: 0.25, payoutFixedCents: 25 },
	pinnedLevel: null,
	overrides: { largestOrderCents: null, weeklySalesCents: null, payoutDelayDays: null },
};

export interface SellerRecord {
	firstSaleAt: Date | null;
	completedOrders: number;
	ordersLast90Days: number;
	disputesLast90Days: number;
	lostDisputesLast90Days: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function sellerLevelOf(record: SellerRecord, settings: SellerLimitsSettings, nowMs: number): SellerLevel {
	if (settings.pinnedLevel) return settings.pinnedLevel;
	const rules = settings.graduation;
	const oldEnough = record.firstSaleAt !== null && nowMs - record.firstSaleAt.getTime() >= rules.daysSinceFirstSale * DAY_MS;
	// Chargebacks on older orders with no recent ones are over any rate.
	const disputeRate = record.ordersLast90Days === 0 ? (record.disputesLast90Days > 0 ? Number.POSITIVE_INFINITY : 0) : (record.disputesLast90Days / record.ordersLast90Days) * 100;
	const established = oldEnough && record.completedOrders >= rules.completedOrders && record.lostDisputesLast90Days === 0 && disputeRate < rules.maxDisputeRatePercent;
	return established ? 'established' : 'new';
}

export function limitsFor(level: SellerLevel, settings: SellerLimitsSettings): SellerLevelLimits {
	const base = settings.levels[level];
	return {
		largestOrderCents: settings.overrides.largestOrderCents ?? base.largestOrderCents,
		weeklySalesCents: settings.overrides.weeklySalesCents ?? base.weeklySalesCents,
		payoutDelayDays: settings.overrides.payoutDelayDays ?? base.payoutDelayDays,
	};
}

/** What a cart counts toward the weekly cap: the seller's own lines twice, since Estori can't prove their delivery. */
export function weightedCartCents(cart: { totalCents: number; lines: ReadonlyArray<{ kind: 'own' | 'catalog'; unitPriceCents: number; quantity: number }> }): number {
	return cart.totalCents + cart.lines.filter((line) => line.kind === 'own').reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
}

export interface SellerLimitsData {
	level: SellerLevel;
	largestOrderCents: number;
	weeklySalesCents: number;
	weeklySalesUsedCents: number;
	payoutDelayDays: number;
	/** What's left before the next level; null at the top level or when an admin pinned the level. */
	nextLevel: { completedOrders: number; completedOrdersNeeded: number; daysSinceFirstSale: number; daysNeeded: number } | null;
}
