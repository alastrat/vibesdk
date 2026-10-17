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

	it('never gives Basic a capability that is not available yet, unless it comes to every plan when it launches', () => {
		for (const section of PLAN_COMPARISON) {
			if (!section.capability || CAPABILITIES[section.capability].status === 'available' || section.everyPlan) continue;
			for (const row of section.rows) expect(row.cells.basic).toBe(false);
		}
		// Store payments come to every plan, Basic included (owner, 2026-10-17).
		expect(PLAN_COMPARISON.filter((section) => section.everyPlan).map((section) => section.capability)).toEqual(['payments']);
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
		// Checkout weighs own products twice toward the weekly cap, so the table says so beside the cap.
		expect(cells('Own products in weekly sales')).toEqual({ basic: 'Count twice', premium: 'Count twice', enterprise: 'Count twice' });
		expect(SELLER_LEVEL_LIMITS.map((level) => level.largestOrder)).toEqual([formatUsd(fresh.largestOrderCents), formatUsd(established.largestOrderCents)]);
	});

	it("sets the payment rules and limits by seller level, so they're the same on every plan, Basic included", () => {
		const payments = PLAN_COMPARISON.find((section) => section.capability === 'payments');
		expect(payments?.rows.length).toBeGreaterThan(5);
		for (const row of payments?.rows ?? []) {
			// Checking the delivery of orders sellers ship themselves is a Premium feature, and the catalog has its own plans.
			if (row.label === 'Delivery checks on orders you ship' || row.label === "Estori's fee on catalog products") continue;
			expect(row.cells.basic, row.label).not.toBe(false);
			expect(row.cells.basic, row.label).toEqual(row.cells.premium);
			expect(row.cells.enterprise, row.label).toEqual(row.cells.premium);
		}
	});

	it("states the catalog fee only on the plans that have the catalog", () => {
		const catalog = PLAN_COMPARISON.find((section) => section.capability === 'product-catalog')?.rows[0]?.cells;
		const fee = PLAN_COMPARISON.find((section) => section.capability === 'payments')?.rows.find((row) => row.label === "Estori's fee on catalog products")?.cells;
		for (const plan of ['basic', 'premium', 'enterprise'] as const) expect(fee?.[plan], plan).toBe(catalog?.[plan] ? 'Card processing and the catalog price' : false);
	});

	it('charges the template fee on every plan, since selling templates works today', () => {
		const builder = PLAN_COMPARISON.find((section) => section.capability === 'store-builder');
		expect(builder?.rows.find((row) => row.label === 'Fee on template sales')?.cells).toEqual({ basic: PLATFORM_FEE_LABEL, premium: PLATFORM_FEE_LABEL, enterprise: PLATFORM_FEE_LABEL });
	});
});
