import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from '@/lib/capabilities';
import { COMPLETED_ORDER_MIN_AGE_DAYS, DEFAULT_SELLER_LIMITS, PLATFORM_FEE_LABEL } from '@/api-types';
import { OWN_PRODUCTS_WEIGHTING } from '@/lib/plans';
import { stripeFeesText } from '@/components/payments/payout-costs';
import { CATALOG_FULFILLMENT_COPY, COMMUNITIES_COPY, EMAIL_MARKETING_COPY, PAYMENTS_COPY, SEARCH_OPTIMIZATION_COPY, SUBSCRIPTIONS_COPY, WEB_ANALYTICS_COPY } from './solution-pages';

const COPIES = {
	'catalog & fulfillment': CATALOG_FULFILLMENT_COPY,
	subscriptions: SUBSCRIPTIONS_COPY,
	communities: COMMUNITIES_COPY,
	'email marketing': EMAIL_MARKETING_COPY,
	'web analytics': WEB_ANALYTICS_COPY,
	'SEO, GEO & AEO': SEARCH_OPTIMIZATION_COPY,
	payments: PAYMENTS_COPY,
};

describe('solution and platform pages', () => {
	it('ties each page to the capability whose status it shows', () => {
		expect(SUBSCRIPTIONS_COPY.capability).toBe('subscriptions');
		// Communities share the early access of digital products and community.
		expect(COMMUNITIES_COPY.capability).toBe('digital-products');
		expect(EMAIL_MARKETING_COPY.capability).toBe('email-marketing');
		expect(WEB_ANALYTICS_COPY.capability).toBe('web-analytics');
		expect(SEARCH_OPTIMIZATION_COPY.capability).toBe('search-optimization');
		expect(CATALOG_FULFILLMENT_COPY.capability).toBe('product-catalog');
	});

	it('says suppliers ship catalog orders, and sellers ship the products they make themselves', () => {
		const answers = CATALOG_FULFILLMENT_COPY.faq.map((item) => item.answer).join(' ');
		expect(answers).toContain('the supplier ships each order directly to your customer');
		expect(answers).toContain('you ship them yourself');
		expect(CATALOG_FULFILLMENT_COPY.more).toEqual({ to: '/solutions/resellers', label: 'Estori for dropshippers and resellers' });
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

	it("keeps future capabilities marked as not yet available, while catalog and payments are open", () => {
		for (const [name, copy] of Object.entries(COPIES)) {
			if (CAPABILITIES[copy.capability].status === 'available') {
				expect(copy.faq.some((item) => item.answer.startsWith('Yes.')), name).toBe(true);
			} else {
				expect(copy.faq.some((item) => item.answer.startsWith('Not yet')), name).toBe(true);
			}
		}
	});

	it('explains GEO and AEO on the SEO page, and points to how AI recommendations work', () => {
		const text = JSON.stringify(SEARCH_OPTIMIZATION_COPY);
		expect(text).toContain('generative engine optimization');
		expect(text).toContain('answer engine optimization');
		expect(SEARCH_OPTIMIZATION_COPY.more).toEqual({ to: '/agentic-commerce', label: 'How AI recommendations work' });
	});

	it('explains payments as the selling terms do: the seller sells, what Estori keeps, refunds, disputes, holds and payouts', () => {
		expect(PAYMENTS_COPY.capability).toBe('payments');
		const text = JSON.stringify(PAYMENTS_COPY);
		for (const phrase of [
			'merchant of record',
			"your store's own address",
			'card processing',
			'catalog price',
			PLATFORM_FEE_LABEL,
			'another country',
			'You pay the whole refund',
			'dispute fee',
			'24 hours',
			stripeFeesText(DEFAULT_SELLER_LIMITS.costs),
		]) {
			expect(text, phrase).toContain(phrase);
		}
		expect(PAYMENTS_COPY.more).toEqual({ to: '/pricing#compare-title', label: 'Payments in each plan' });
	});

	it('says how a seller moves up a level, with every rule the level check uses', () => {
		const { daysSinceFirstSale, completedOrders, maxDisputeRatePercent } = DEFAULT_SELLER_LIMITS.graduation;
		const answer = PAYMENTS_COPY.faq.find((item) => item.question === 'How do my limits grow?')?.answer ?? '';
		expect(answer).toContain(`${daysSinceFirstSale} days`);
		expect(answer).toContain(`${completedOrders} completed orders`);
		expect(answer).toContain(`fewer than ${maxDisputeRatePercent}% of orders disputed`);
		expect(answer).toContain('no lost disputes in the last 90 days');
		expect(answer).toContain(`at least ${COMPLETED_ORDER_MIN_AGE_DAYS} days old`);
	});

	it('says every plan takes payments, with the same limits', () => {
		expect(PAYMENTS_COPY.faq.find((item) => item.question === 'Do my limits depend on my plan?')?.answer).toBe('No. Your seller level sets them, the same on every plan.');
	});

	it('says own products count twice toward the weekly limit, as checkout counts them', () => {
		const answer = PAYMENTS_COPY.faq.find((item) => item.question === 'Why does my store have limits?')?.answer ?? '';
		expect(answer).toContain(OWN_PRODUCTS_WEIGHTING);
	});
});
