import { describe, expect, it } from 'vitest';
import { pageTitle } from '@/brand';
import {
	INDUSTRIES,
	findIndustry,
	industriesStructuredData,
	industryCrumbs,
	industryFaq,
	industryPath,
	industryPhotoSrcSet,
	industryStructuredData,
} from './industries';

const PHOTOS = import.meta.glob('/public/marketing/industries/*.webp', { query: '?url', import: 'default', eager: true });
const ORIGIN = 'https://estori.example';

function words(text: string): number {
	return text.trim().split(/\s+/).length;
}

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

	it('gives every page its own credited Unsplash photo, in a full and a card size', () => {
		const files = Object.keys(PHOTOS);
		for (const industry of INDUSTRIES) {
			const { photo } = industry;
			expect(photo.src, industry.slug).toBe(`/marketing/industries/${industry.slug}.webp`);
			for (const candidate of industryPhotoSrcSet(photo).split(', ')) {
				const [src, width] = candidate.split(' ');
				expect(files, industry.slug).toContain(`/public${src}`);
				expect(width).toMatch(/^(640|1200)w$/);
			}
			expect(words(photo.alt), industry.slug).toBeGreaterThanOrEqual(6);
			expect(photo.photographer.trim(), industry.slug).not.toBe('');
			expect(photo.url, industry.slug).toMatch(/^https:\/\/unsplash\.com\/photos\/[\w-]+$/);
		}
		expect(new Set(INDUSTRIES.map((industry) => industry.photo.url)).size).toBe(INDUSTRIES.length);
	});

	it('gives every page a search title and description that fit in search results', () => {
		for (const industry of INDUSTRIES) {
			expect(industry.metaTitle, industry.slug).toMatch(/^AI Online Store Builder for .+ Brands$/);
			expect(pageTitle(industry.metaTitle).length, industry.slug).toBeLessThanOrEqual(60);
			expect(industry.metaDescription, industry.slug).toMatch(/^Build an online store for your .+ with AI\. .+ Free to build\.$/);
			expect(industry.metaDescription.length, industry.slug).toBeGreaterThanOrEqual(120);
			expect(industry.metaDescription.length, industry.slug).toBeLessThanOrEqual(160);
		}
		expect(new Set(INDUSTRIES.map((industry) => industry.metaTitle)).size).toBe(INDUSTRIES.length);
	});

	it('opens every page with a direct answer that search engines and AI assistants can quote', () => {
		for (const industry of INDUSTRIES) {
			expect(industry.summary, industry.slug).toMatch(/^Estori is an AI store builder for /);
			expect(industry.summary, industry.slug).toContain('catalog, product pages, cart and checkout flow');
			expect(words(industry.summary), industry.slug).toBeGreaterThanOrEqual(40);
			expect(words(industry.summary), industry.slug).toBeLessThanOrEqual(70);
		}
	});

	it("answers the questions a seller in each industry would ask, honestly about what isn't built yet", () => {
		for (const industry of INDUSTRIES) {
			const faq = industryFaq(industry);
			expect(faq.length, industry.slug).toBeGreaterThanOrEqual(5);
			expect(new Set(faq.map((item) => item.question)).size, industry.slug).toBe(faq.length);
			for (const item of faq) {
				expect(item.question, industry.slug).toMatch(/\?$/);
				expect(item.answer.trim(), item.question).not.toBe('');
			}
			const payments = faq.find((item) => item.question === `Can my ${industry.store} take payments?`);
			expect(payments?.answer, industry.slug).toMatch(/^Not yet\..*coming soon\.$/);
			expect(faq.find((item) => item.question.startsWith('How much does it cost'))?.answer, industry.slug).toContain('free within daily limits');
		}
	});

	it('places every page under Industries in its breadcrumb trail', () => {
		for (const industry of INDUSTRIES) {
			expect(industryCrumbs(industry)).toEqual([
				{ name: 'Home', path: '/' },
				{ name: 'Industries', path: '/industries' },
				{ name: industry.name, path: industryPath(industry.slug) },
			]);
		}
	});

	it('describes an industry page as a web page with its photo, breadcrumb trail and questions', () => {
		const industry = INDUSTRIES[0];
		const faq = industryFaq(industry);
		expect(industryStructuredData(industry, ORIGIN)).toMatchObject({
			'@context': 'https://schema.org',
			'@graph': [
				{
					'@type': 'WebPage',
					url: `${ORIGIN}/industries/${industry.slug}`,
					name: pageTitle(industry.metaTitle),
					description: industry.metaDescription,
					primaryImageOfPage: {
						'@type': 'ImageObject',
						url: `${ORIGIN}/marketing/industries/${industry.slug}.webp`,
						creditText: `${industry.photo.photographer} on Unsplash`,
					},
					about: { '@type': 'SoftwareApplication', name: 'Estori' },
				},
				{
					'@type': 'BreadcrumbList',
					itemListElement: [
						{ '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
						{ '@type': 'ListItem', position: 2, name: 'Industries', item: `${ORIGIN}/industries` },
						{ '@type': 'ListItem', position: 3, name: industry.name, item: `${ORIGIN}/industries/${industry.slug}` },
					],
				},
				{
					'@type': 'FAQPage',
					mainEntity: faq.map((item) => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })),
				},
			],
		});
	});

	it('describes the industries page as a collection that lists every industry page', () => {
		expect(industriesStructuredData(ORIGIN)).toMatchObject({
			'@context': 'https://schema.org',
			'@graph': [
				{ '@type': 'CollectionPage', url: `${ORIGIN}/industries` },
				{ '@type': 'BreadcrumbList', itemListElement: [{ name: 'Home' }, { name: 'Industries', item: `${ORIGIN}/industries` }] },
				{
					'@type': 'ItemList',
					itemListElement: INDUSTRIES.map((industry, index) => ({
						'@type': 'ListItem',
						position: index + 1,
						name: industry.name,
						url: `${ORIGIN}/industries/${industry.slug}`,
					})),
				},
			],
		});
	});
});
