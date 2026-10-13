import { describe, expect, it } from 'vitest';
import { EMPTY_PAGE_COPY_FORM, fromPageCopyForm, isEmptyPageCopyForm, toPageCopyForm } from './page-copy-form';
import type { SitePageCopy } from '@/api-types';

const COPY: SitePageCopy = {
	tagline: 'A calm site',
	about: ['First paragraph.', 'Second paragraph.'],
	features: ['Schedule', 'Pricing', 'Bios'],
	includes: [{ name: 'Home', detail: 'Hero and schedule' }],
	madeFor: ['Studios', 'Teachers'],
};

describe('page copy form', () => {
	it('round-trips page text through the editable fields', () => {
		expect(toPageCopyForm(COPY)).toEqual({
			tagline: 'A calm site',
			about: 'First paragraph.\n\nSecond paragraph.',
			features: 'Schedule\nPricing\nBios',
			includes: 'Home: Hero and schedule',
			madeFor: 'Studios\nTeachers',
		});
		expect(fromPageCopyForm(toPageCopyForm(COPY))).toEqual(COPY);
	});

	it('reads one item per line, skips blank lines and splits includes on the first colon', () => {
		const copy = fromPageCopyForm({
			...EMPTY_PAGE_COPY_FORM,
			features: 'A\n\n  B  \n',
			includes: 'Home: Hero: big\nAbout',
		});
		expect(copy.features).toEqual(['A', 'B']);
		expect(copy.includes).toEqual([
			{ name: 'Home', detail: 'Hero: big' },
			{ name: 'About', detail: '' },
		]);
	});

	it('knows when every field is empty', () => {
		expect(isEmptyPageCopyForm(EMPTY_PAGE_COPY_FORM)).toBe(true);
		expect(isEmptyPageCopyForm({ ...EMPTY_PAGE_COPY_FORM, tagline: '  ' })).toBe(true);
		expect(isEmptyPageCopyForm({ ...EMPTY_PAGE_COPY_FORM, madeFor: 'x' })).toBe(false);
		expect(toPageCopyForm(null)).toEqual(EMPTY_PAGE_COPY_FORM);
	});
});
