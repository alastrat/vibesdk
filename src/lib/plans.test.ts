import { describe, expect, it } from 'vitest';
import { DEFAULT_SELLER_LIMITS } from '@/api-types';
import { CAPABILITIES } from './capabilities';
import { PLANS, PLAN_COMPARISON, SELLER_LEVEL_LIMITS, comparisonFor, formatCredits, formatUsd, limitFeatures, planById, storeAllowance } from './plans';

describe('plans', () => {
	it('compares Basic, Pro and Premium independently of checkout activation', () => {
		const comparison = comparisonFor();
		expect(comparison.plans.map((plan) => plan.id)).toEqual(['basic', 'pro', 'premium']);
		expect(comparison.sections.flatMap((section) => section.rows).map((row) => row.label)).not.toContain('Fee on template sales');
		expect(comparison.sections.flatMap((section) => section.rows).map((row) => row.label)).not.toContain('Drafts per store, including Main');
	});

	it('places digital products before the coming-soon sections', () => {
		const capabilities = PLAN_COMPARISON.map((section) => section.capability);
		const digital = capabilities.indexOf('digital-products');
		expect(digital).toBeGreaterThan(-1);
		for (const [index, section] of PLAN_COMPARISON.entries()) {
			if (section.capability && CAPABILITIES[section.capability].status === 'coming-soon') expect(digital).toBeLessThan(index);
		}
	});

	it('keeps unavailable rows below included benefits for every plan in each section', () => {
		for (const section of PLAN_COMPARISON) {
			for (const plan of ['basic', 'pro', 'premium'] as const) {
				let reachedUnavailable = false;
				for (const row of section.rows) {
					if (row.cells[plan] === false) reachedUnavailable = true;
					else expect(reachedUnavailable, `${section.title}: ${row.id} on ${plan}`).toBe(false);
				}
			}
		}
	});

	it('looks a plan up by id', () => {
		expect(planById('premium')).toBe(PLANS[2]);
		expect(planById('enterprise').name).toBe('Enterprise');
	});

	it('offers Basic, Pro, Premium and Enterprise, in that order', () => {
		expect(PLANS.map((plan) => plan.id)).toEqual(['basic', 'pro', 'premium', 'enterprise']);
	});

	it("states each paid plan's store allowance from the limits table", () => {
		expect(storeAllowance('pro')).toBe('Up to 5 live stores');
		expect(storeAllowance('premium')).toBe('Up to 20 live stores');
		expect(limitFeatures('pro')).toEqual(['Up to 5 live stores', 'Your own domain on each live store', 'The supplier catalog']);
		// Premium's card starts from "Everything in Pro", so it lists only what Pro doesn't have.
		expect(limitFeatures('premium', 'pro')).toEqual(['Up to 20 live stores']);
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
			for (const row of section.rows) expect(Object.keys(row.cells).sort()).toEqual(['basic', 'enterprise', 'premium', 'pro']);
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

	it('compares payment benefits and links to fees, limits and timing separately', () => {
		const payments = PLAN_COMPARISON.find((section) => section.capability === 'payments');
		expect(payments?.rows.map((row) => row.id)).toEqual(['checkout', 'bankPayouts', 'payouts']);
		for (const id of ['checkout', 'bankPayouts']) expect(payments?.rows.find((row) => row.id === id)?.cells).toEqual({ basic: true, pro: true, premium: true, enterprise: true });
		expect(payments?.rows.find((row) => row.id === 'payouts')?.cells).toEqual({ basic: false, pro: true, premium: true, enterprise: true });
		expect(payments?.details?.href).toBe('/platform/payments#limits');
	});

	it('keeps the seller-level disclosures aligned with the settings checkout enforces', () => {
		const { new: fresh, established } = DEFAULT_SELLER_LIMITS.levels;
		expect(SELLER_LEVEL_LIMITS.map((level) => level.largestOrder)).toEqual([formatUsd(fresh.largestOrderCents), formatUsd(established.largestOrderCents)]);
		expect(SELLER_LEVEL_LIMITS.map((level) => level.weeklySales)).toEqual([formatUsd(fresh.weeklySalesCents), formatUsd(established.weeklySalesCents)]);
	});

	it('keeps template fees and draft counts out of the benefit comparison', () => {
		const labels = PLAN_COMPARISON.flatMap((section) => section.rows.map((row) => row.label));
		expect(labels).not.toContain('Fee on template sales');
		expect(labels).not.toContain('Drafts per store, including Main');
	});

	it('keeps seller alerts and template receipts on every plan, with shopper emails and sender addresses on paid plans', () => {
		const every = { basic: true, pro: true, premium: true, enterprise: true };
		const row = (capability: string, label: string) => PLAN_COMPARISON.find((section) => section.capability === capability || section.title === capability)?.rows.find((entry) => entry.id === label)?.cells;
		expect(row('Email & notifications', 'sellerEmails')).toEqual(every);
		expect(row('Email & notifications', 'shopperEmails')).toEqual({ basic: false, pro: true, premium: true, enterprise: true });
		expect(row('Email & notifications', 'editEmails')).toEqual({ basic: false, pro: false, premium: true, enterprise: true });
		expect(row('Email & notifications', 'brandedEmails')).toEqual({ basic: false, pro: true, premium: true, enterprise: true });
		expect(row('store-builder', 'receipts')).toEqual(every);
		expect(row('order-management', 'filterOrders')).toBeUndefined();
		for (const id of ['tracking', 'refunds']) expect(row('order-management', id)).toEqual({ basic: false, pro: false, premium: true, enterprise: true });
		expect(row('Email & notifications', 'replyToEmails')).toEqual({ basic: false, pro: false, premium: true, enterprise: true });
		for (const id of ['orderStatus']) expect(row('order-management', id)).toEqual(every);
		for (const id of ['previewEmails']) expect(row('Email & notifications', id)).toEqual({ basic: false, pro: true, premium: true, enterprise: true });
	});

	it('takes store and catalog allowances from the shared limits without separate live-store or top-up rows', () => {
		const builder = PLAN_COMPARISON.find((section) => section.capability === 'store-builder');
		const cells = (label: string) => builder?.rows.find((row) => row.id === label)?.cells;
		expect(cells('stores')).toEqual({ basic: '2', pro: '5', premium: '20', enterprise: 'Custom' });
		expect(cells('liveStores')).toBeUndefined();
		expect(cells('extraCredits')).toBeUndefined();
		const catalog = PLAN_COMPARISON.find((section) => section.capability === 'product-catalog');
		expect(catalog?.rows.map(row => row.id)).toEqual(['ownProducts', 'catalog', 'fulfillment']);
		for (const row of catalog!.rows) expect(row.cells).toEqual({ basic: true, pro: true, premium: true, enterprise: true });
		expect(limitFeatures('pro', 'basic')).toEqual(['Up to 5 live stores', 'Your own domain on each live store']);
	});

	it('includes launch and domain benefits in the public comparison', () => {
		const comparison = comparisonFor();
		expect(comparison.plans.map((plan) => plan.id)).toEqual(['basic', 'pro', 'premium']);
		const builder = comparison.sections.find((section) => section.capability === 'store-builder');
		for (const id of ['stores', 'domain', 'publish']) {
			expect(builder?.rows.some((row) => row.id === id), id).toBe(true);
		}
	});

	it('explains every feature and keeps translations credit-metered', () => {
		const ids = PLAN_COMPARISON.flatMap((section) => section.rows.map((row) => row.id));
		expect(new Set(ids).size).toBe(ids.length);
		for (const section of PLAN_COMPARISON) {
			for (const row of section.rows) {
				expect(row.description.trim().length, row.id).toBeGreaterThan(20);
			}
		}
		const translations = PLAN_COMPARISON.find((section) => section.capability === 'store-translations');
		expect(translations?.rows.find((row) => row.id === 'aiTranslation')?.cells).toEqual({basic: false, pro: true, premium: true, enterprise: true});
		expect(translations?.rows.some((row) => row.id === 'storeLanguages')).toBe(false);
		for (const row of translations?.rows ?? []) {
			expect(row.cells.basic, row.id).toBe(false);
			expect(row.cells.pro, row.id).not.toBe(false);
			expect(row.cells.premium, row.id).not.toBe(false);
		}
		expect(translations?.rows.some((row) => row.id === 'translationControl')).toBe(true);
	});
});
