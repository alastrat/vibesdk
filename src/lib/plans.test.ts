import { describe, expect, it } from 'vitest';
import { DEFAULT_SELLER_LIMITS, PLATFORM_FEE_LABEL } from '@/api-types';
import { CAPABILITIES } from './capabilities';
import { PLANS, PLAN_COMPARISON, PREMIUM_TIERS, SELLER_LEVEL_LIMITS, formatCredits, formatUsd, planById, premiumTierFor } from './plans';

describe('plans', () => {
	it('looks a plan up by id', () => {
		expect(planById('premium')).toBe(PLANS[1]);
		expect(planById('enterprise').name).toBe('Enterprise');
	});

	it('offers Basic, Premium and Enterprise, in that order', () => {
		expect(PLANS.map((plan) => plan.id)).toEqual(['basic', 'premium', 'enterprise']);
	});

	it('starts Premium at 99 USD, with larger credit pools at higher prices', () => {
		expect(PREMIUM_TIERS[0]).toEqual({ credits: 20_000, priceCents: 9_900 });
		for (let index = 1; index < PREMIUM_TIERS.length; index++) {
			expect(PREMIUM_TIERS[index].credits).toBeGreaterThan(PREMIUM_TIERS[index - 1].credits);
			expect(PREMIUM_TIERS[index].priceCents).toBeGreaterThan(PREMIUM_TIERS[index - 1].priceCents);
			// Bigger pools cost less per credit.
			expect(PREMIUM_TIERS[index].priceCents / PREMIUM_TIERS[index].credits).toBeLessThan(PREMIUM_TIERS[index - 1].priceCents / PREMIUM_TIERS[index - 1].credits);
		}
	});

	it('picks the smallest Premium pool that covers a need, and none past the largest', () => {
		expect(premiumTierFor(1)).toEqual(PREMIUM_TIERS[0]);
		expect(premiumTierFor(20_000)).toEqual(PREMIUM_TIERS[0]);
		expect(premiumTierFor(20_001)).toEqual(PREMIUM_TIERS[1]);
		const largest = PREMIUM_TIERS[PREMIUM_TIERS.length - 1];
		expect(premiumTierFor(largest.credits)).toEqual(largest);
		expect(premiumTierFor(largest.credits + 1)).toBeNull();
	});

	it('formats prices and credits for the cards', () => {
		expect(formatUsd(9_900)).toBe('$99');
		expect(formatUsd(0)).toBe('$0');
		expect(formatUsd(34_950)).toBe('$349.50');
		expect(formatCredits(20_000)).toBe('20,000');
	});

	it('fills every comparison row for every plan, grouped by real capabilities', () => {
		for (const section of PLAN_COMPARISON) {
			if (section.capability) expect(CAPABILITIES[section.capability]).toBeDefined();
			for (const row of section.rows) expect(Object.keys(row.cells).sort()).toEqual(['basic', 'enterprise', 'premium']);
		}
	});

	it('titles capability sections with the registry names, so a rename reaches pricing', () => {
		for (const section of PLAN_COMPARISON) {
			if (section.capability) expect(section.title).toBe(CAPABILITIES[section.capability].name);
		}
	});

	it('never gives Basic a capability that is not available yet', () => {
		for (const section of PLAN_COMPARISON) {
			if (!section.capability || CAPABILITIES[section.capability].status === 'available') continue;
			for (const row of section.rows) expect(row.cells.basic).toBe(false);
		}
	});

	it("lists the payment rules, with each seller level's limits from the same settings checkout uses", () => {
		const payments = PLAN_COMPARISON.find((section) => section.capability === 'payments');
		const cells = (label: string) => payments?.rows.find((row) => row.label === label)?.cells;
		const { new: fresh, established } = DEFAULT_SELLER_LIMITS.levels;
		expect(cells('Largest order, by seller level')?.premium).toBe(`${formatUsd(fresh.largestOrderCents)} new, ${formatUsd(established.largestOrderCents)} established`);
		expect(cells('Weekly sales, by seller level')?.premium).toBe(`${formatUsd(fresh.weeklySalesCents)} new, ${formatUsd(established.weeklySalesCents)} established`);
		expect(cells('Payout wait, by seller level')?.premium).toBe(`${fresh.payoutDelayDays} business days new, ${established.payoutDelayDays} established`);
		expect(cells("Estori's fee on your own products")?.premium).toBe('Card processing');
		expect(cells("Estori's fee on catalog products")?.premium).toBe('Card processing and the catalog price');
		expect(cells('Refunds and disputes')?.premium).toBe('Paid by the seller');
		expect(cells('Delivery checks on orders you ship')).toEqual({ basic: false, premium: true, enterprise: true });
		expect(SELLER_LEVEL_LIMITS.map((level) => level.largestOrder)).toEqual([formatUsd(fresh.largestOrderCents), formatUsd(established.largestOrderCents)]);
	});

	it("sets the payment limits by seller level, so they're the same on every plan that takes payments", () => {
		const payments = PLAN_COMPARISON.find((section) => section.capability === 'payments');
		expect(payments?.rows.length).toBeGreaterThan(5);
		for (const row of payments?.rows ?? []) expect(row.cells.enterprise, row.label).toEqual(row.cells.premium);
	});

	it('charges the template fee on every plan, since selling templates works today', () => {
		const builder = PLAN_COMPARISON.find((section) => section.capability === 'store-builder');
		expect(builder?.rows.find((row) => row.label === 'Fee on template sales')?.cells).toEqual({ basic: PLATFORM_FEE_LABEL, premium: PLATFORM_FEE_LABEL, enterprise: PLATFORM_FEE_LABEL });
	});
});
