import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from '@/lib/capabilities';
import { COMMUNITIES_COPY, EMAIL_MARKETING_COPY, SEARCH_OPTIMIZATION_COPY, SUBSCRIPTIONS_COPY, WEB_ANALYTICS_COPY } from './solution-pages';

const COPIES = {
	subscriptions: SUBSCRIPTIONS_COPY,
	communities: COMMUNITIES_COPY,
	'email marketing': EMAIL_MARKETING_COPY,
	'web analytics': WEB_ANALYTICS_COPY,
	'SEO, GEO & AEO': SEARCH_OPTIMIZATION_COPY,
};

describe('solution and platform pages', () => {
	it('ties each page to the capability whose status it shows', () => {
		expect(SUBSCRIPTIONS_COPY.capability).toBe('subscriptions');
		// Communities share the early access of digital products and community.
		expect(COMMUNITIES_COPY.capability).toBe('digital-products');
		expect(EMAIL_MARKETING_COPY.capability).toBe('email-marketing');
		expect(WEB_ANALYTICS_COPY.capability).toBe('web-analytics');
		expect(SEARCH_OPTIMIZATION_COPY.capability).toBe('search-optimization');
	});

	it('gives every page two sections of three cards, three steps and its questions', () => {
		for (const [name, copy] of Object.entries(COPIES)) {
			expect(copy.sections, name).toHaveLength(2);
			for (const section of copy.sections) expect(section.cards, `${name}: ${section.title}`).toHaveLength(3);
			expect(copy.steps, name).toHaveLength(3);
			expect(copy.faq.length, name).toBeGreaterThanOrEqual(3);
			for (const item of copy.faq) expect(item.question, name).toMatch(/\?$/);
		}
	});

	it("says plainly that none of them is here yet, since none is available", () => {
		for (const [name, copy] of Object.entries(COPIES)) {
			expect(CAPABILITIES[copy.capability].status, name).not.toBe('available');
			expect(copy.faq.some((item) => item.answer.startsWith('Not yet')), name).toBe(true);
		}
	});

	it('explains GEO and AEO on the SEO page, and points to how AI recommendations work', () => {
		const text = JSON.stringify(SEARCH_OPTIMIZATION_COPY);
		expect(text).toContain('generative engine optimization');
		expect(text).toContain('answer engine optimization');
		expect(SEARCH_OPTIMIZATION_COPY.more).toEqual({ to: '/agentic-commerce', label: 'How AI recommendations work' });
	});
});
