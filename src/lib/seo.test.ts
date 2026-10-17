import { describe, expect, it } from 'vitest';
import { absoluteUrl, breadcrumbList, faqPage, serializeJsonLd } from './seo';

const ORIGIN = 'https://estori.example';

describe('seo', () => {
	it('turns a site path into a full address on the current origin', () => {
		expect(absoluteUrl('/', ORIGIN)).toBe(`${ORIGIN}/`);
		expect(absoluteUrl('/industries/pets', ORIGIN)).toBe(`${ORIGIN}/industries/pets`);
	});

	it('numbers a breadcrumb trail from 1, with a full address for each step', () => {
		expect(breadcrumbList([{ name: 'Home', path: '/' }, { name: 'Blog', path: '/blog' }], ORIGIN)).toEqual({
			'@type': 'BreadcrumbList',
			itemListElement: [
				{ '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
				{ '@type': 'ListItem', position: 2, name: 'Blog', item: `${ORIGIN}/blog` },
			],
		});
	});

	it('pairs every question with its answer', () => {
		expect(faqPage([{ question: 'Is it free?', answer: 'Yes.' }])).toEqual({
			'@type': 'FAQPage',
			mainEntity: [{ '@type': 'Question', name: 'Is it free?', acceptedAnswer: { '@type': 'Answer', text: 'Yes.' } }],
		});
	});

	it('escapes "<" so the data can never close its script tag', () => {
		const serialized = serializeJsonLd({ name: '</script><b>bold</b>' });
		expect(serialized).not.toContain('<');
		expect(JSON.parse(serialized)).toEqual({ name: '</script><b>bold</b>' });
	});
});
