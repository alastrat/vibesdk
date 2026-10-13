import { describe, expect, it } from 'vitest';
import { initialProjectTitle, siteCopyQuery, siteStartInstruction } from './site-start';

const derive = (text: string) => `derived:${text}`;

describe('siteStartInstruction', () => {
	it('writes the personalization instruction verbatim', () => {
		expect(siteStartInstruction('Fernwood', 'A bakery in Lisbon')).toBe(
			"This app started as a copy of the site Fernwood. Keep its layout, components, styles and working features. Rewrite every piece of text, every brand and product name, every price and every image for: A bakery in Lisbon. Keep none of the original site's copy. Then deploy.",
		);
	});
});

describe('siteCopyQuery', () => {
	it('stores a non-empty query for an exact copy', () => {
		expect(siteCopyQuery('Fernwood')).toBe('Start from Fernwood');
	});
});

describe('initialProjectTitle', () => {
	it('titles an exact copy after the site', () => {
		expect(initialProjectTitle('', 'Fernwood', derive)).toBe('Fernwood copy');
		expect(initialProjectTitle('   ', 'Fernwood', derive)).toBe('Fernwood copy');
	});

	it('titles a described start from the description', () => {
		expect(initialProjectTitle('A bakery in Lisbon', 'Fernwood', derive)).toBe('derived:A bakery in Lisbon');
	});

	it('keeps the default title without a site', () => {
		expect(initialProjectTitle('', undefined, derive)).toBe('derived:project');
	});
});
