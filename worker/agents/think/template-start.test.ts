import { describe, expect, it } from 'vitest';
import { initialProjectTitle, templateCopyQuery, templateStartInstruction } from './template-start';

const derive = (text: string) => `derived:${text}`;

describe('templateStartInstruction', () => {
	it('writes the personalization instruction verbatim', () => {
		expect(templateStartInstruction('Fernwood', 'A bakery in Lisbon')).toBe(
			"This app started from the template Fernwood. Keep its layout, components, styles and working features. Rewrite every piece of text, every brand and product name, every price and every image for: A bakery in Lisbon. Keep none of the template's original copy. Then deploy.",
		);
	});
});

describe('templateCopyQuery', () => {
	it('stores a non-empty query for an exact copy', () => {
		expect(templateCopyQuery('Fernwood')).toBe('Start from template Fernwood');
	});
});

describe('initialProjectTitle', () => {
	it('titles an exact copy after the template', () => {
		expect(initialProjectTitle('', 'Fernwood', derive)).toBe('Fernwood copy');
		expect(initialProjectTitle('   ', 'Fernwood', derive)).toBe('Fernwood copy');
	});

	it('titles a described start from the description', () => {
		expect(initialProjectTitle('A bakery in Lisbon', 'Fernwood', derive)).toBe('derived:A bakery in Lisbon');
	});

	it('keeps the default title without a template', () => {
		expect(initialProjectTitle('', undefined, derive)).toBe('derived:project');
	});
});
