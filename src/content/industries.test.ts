import { describe, expect, it } from 'vitest';
import { pageTitle } from '@/brand';
import { contrastRatio } from '@/lib/color-contrast';
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
const FEATURE_PHOTOS = import.meta.glob('/public/marketing/industries/features/*.webp', { query: '?url', import: 'default', eager: true });
const UNSPLASH_PAGE = /^https:\/\/unsplash\.com\/photos\/[\w-]+$/;
const HEX = /^#[0-9a-f]{6}$/;
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

	it('gives every feature its own credited photo, in a full and a phone size', () => {
		const files = Object.keys(FEATURE_PHOTOS);
		const features = INDUSTRIES.flatMap((industry) => industry.features.map((feature) => ({ industry, feature })));
		expect(new Set(features.map(({ feature }) => feature.photo.url)).size).toBe(features.length);
		for (const { industry, feature } of features) {
			const label = `${industry.slug}: ${feature.title}`;
			expect(feature.photo.src, label).toMatch(new RegExp(`^/marketing/industries/features/${industry.slug}-[a-z]+\\.webp$`));
			for (const candidate of industryPhotoSrcSet(feature.photo).split(', ')) {
				expect(files, label).toContain(`/public${candidate.split(' ')[0]}`);
			}
			expect(words(feature.photo.alt), label).toBeGreaterThanOrEqual(6);
			expect(feature.photo.photographer.trim(), label).not.toBe('');
			expect(feature.photo.url, label).toMatch(UNSPLASH_PAGE);
			expect(feature.photo.url, label).not.toBe(industry.photo.url);
		}
	});

	it('pairs every feature with an example request and its own panel color that white text reads on', () => {
		for (const industry of INDUSTRIES) {
			expect(new Set(industry.features.map((feature) => feature.accent)).size, industry.slug).toBe(industry.features.length);
			for (const feature of industry.features) {
				const label = `${industry.slug}: ${feature.title}`;
				// Written as the seller would ask, without quote marks: the carousel adds them.
				expect(feature.request, label).toMatch(/^[A-Z][^"\u201c\u201d]+\.$/);
				expect(feature.accent, label).toMatch(HEX);
				expect(contrastRatio('#ffffff', feature.accent), label).toBeGreaterThanOrEqual(7);
			}
		}
	});

	it('draws a piece of the store over each feature photo, filled with content for that feature', () => {
		for (const industry of INDUSTRIES) {
			for (const { title, preview } of industry.features) {
				const label = `${industry.slug}: ${title}`;
				expect(preview.title.trim(), label).not.toBe('');
				switch (preview.kind) {
					case 'swatches':
						expect(preview.swatches.length, label).toBeGreaterThanOrEqual(4);
						for (const swatch of preview.swatches) expect(swatch, label).toMatch(HEX);
						expect(preview.selected, label).toBeLessThan(preview.swatches.length);
						expect(preview.caption.trim(), label).not.toBe('');
						break;
					case 'options':
						expect(preview.options.length, label).toBeGreaterThanOrEqual(3);
						expect(preview.selected, label).toBeLessThan(preview.options.length);
						break;
					case 'table':
						expect(preview.rows.length, label).toBeGreaterThanOrEqual(3);
						break;
					case 'list':
						expect(preview.items.length, label).toBeGreaterThanOrEqual(3);
						break;
					case 'bundle':
						expect(preview.items.length, label).toBeGreaterThanOrEqual(3);
						expect(preview.price.trim(), label).not.toBe('');
						break;
				}
			}
		}
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
			// A casual question to the seller, then a plain answer that still names Estori, its AI and what the store has.
			expect(industry.summary, industry.slug).toMatch(/^[A-Z][^.?]+\? Tell Estori /);
			expect(industry.summary, industry.slug).not.toMatch(/^Estori is /);
			expect(industry.summary, industry.slug).toContain('its AI builds you a complete online store');
			expect(industry.summary, industry.slug).toMatch(/\? Just ask, no code needed\.$/);
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
			// Plan-neutral, so it holds whether paid plans are on sale or not.
			const cost = faq.find((item) => item.question.startsWith('How much does it cost'))?.answer;
			expect(cost, industry.slug).toContain('free on Basic, within its limits. See the pricing page for what each plan includes.');
			expect(cost, industry.slug).not.toMatch(/daily|coming soon/);
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
