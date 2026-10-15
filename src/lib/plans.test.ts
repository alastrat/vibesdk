import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from './capabilities';
import { PLANS, PLAN_COMPARISON, formatCredits, formatPlanPrice, liveStoresLabel } from './plans';

describe('plans', () => {
	it('offers Free today and three paid plans marked coming soon', () => {
		expect(PLANS.map((plan) => [plan.id, plan.status, plan.priceCents, plan.monthlyCredits, plan.liveStores])).toEqual([
			['free', 'available', 0, null, null],
			['starter', 'coming-soon', 2_900, 10_000, 1],
			['growth', 'coming-soon', 7_900, 30_000, 3],
			['scale', 'coming-soon', 24_900, 100_000, 10],
		]);
	});

	it('formats prices, credits and store counts for the cards', () => {
		expect(PLANS.map(formatPlanPrice)).toEqual(['$0', '$29', '$79', '$249']);
		expect(formatCredits(10_000)).toBe('10,000');
		expect(liveStoresLabel(null)).toBe('Build and preview');
		expect(liveStoresLabel(1)).toBe('1 live store');
		expect(liveStoresLabel(3)).toBe('3 live stores');
	});

	it('fills every comparison row for every plan, grouped by real capabilities', () => {
		for (const section of PLAN_COMPARISON) {
			if (section.capability) expect(CAPABILITIES[section.capability]).toBeDefined();
			for (const row of section.rows) expect(Object.keys(row.cells).sort()).toEqual(['free', 'growth', 'scale', 'starter']);
		}
	});

	it('titles capability sections with the registry names, so a rename reaches pricing', () => {
		for (const section of PLAN_COMPARISON) {
			if (section.capability) expect(section.title).toBe(CAPABILITIES[section.capability].name);
		}
	});

	it('never gives the free plan a capability that is not available yet', () => {
		for (const section of PLAN_COMPARISON) {
			if (!section.capability || CAPABILITIES[section.capability].status === 'available') continue;
			for (const row of section.rows) expect(row.cells.free).toBe(false);
		}
	});
});
