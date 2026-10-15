import { describe, expect, it } from 'vitest';
import { INDUSTRIES, findIndustry, industryPath } from './industries';

describe('industries', () => {
	it('lists each industry once, at its own page', () => {
		expect(new Set(INDUSTRIES.map((industry) => industry.slug)).size).toBe(INDUSTRIES.length);
		for (const industry of INDUSTRIES) {
			expect(industryPath(industry.slug)).toBe(`/industries/${industry.slug}`);
			expect(findIndustry(industry.slug)).toBe(industry);
		}
		expect(findIndustry('no-such-industry')).toBeUndefined();
	});

	it('targets the verticals that sell online, without a catch-all e-commerce entry', () => {
		const names = INDUSTRIES.map((industry) => industry.name);
		for (const name of ['Beauty & Personal Care', 'Fashion & Apparel', 'Health & Wellness', 'Food & Beverage']) expect(names).toContain(name);
		expect(names.some((name) => /e-?commerce/i.test(name))).toBe(false);
	});

	it('gives every page three example requests and three things its stores can include', () => {
		for (const industry of INDUSTRIES) {
			expect(industry.prompts, industry.slug).toHaveLength(3);
			expect(industry.features, industry.slug).toHaveLength(3);
			expect(industry.title, industry.slug).toMatch(/^An online store for .+, built in minutes$/);
		}
	});
});
