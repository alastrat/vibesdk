import { describe, expect, it } from 'vitest';
import {
	normalizePageCopy,
	normalizeText,
	parseStoredPageCopy,
	samePageCopy,
	validatePageCopy,
	type SitePageCopy,
} from './site-page';

const VALID: SitePageCopy = {
	tagline: 'A calm one-page site for a small yoga studio',
	about: ['Lumen is a one-page site with a weekly schedule.', 'It loads fast and reads well on phones.'],
	features: ['Weekly class schedule', 'Three pricing plans', 'Instructor bios'],
	includes: [{ name: 'Home', detail: 'Hero, schedule, pricing and bios on one page' }],
	madeFor: ['Yoga studios', 'Pilates teachers'],
};

function repeat(length: number): string {
	return 'x'.repeat(length);
}

describe('normalizeText', () => {
	it('trims, collapses whitespace and drops control characters', () => {
		expect(normalizeText('  Hello\n\n  world\u0007 ')).toBe('Hello world');
	});
});

describe('validatePageCopy', () => {
	it('accepts page text within every limit', () => {
		expect(validatePageCopy(VALID)).toEqual({ ok: true, value: VALID });
	});

	it('normalizes before validating and drops empty list entries', () => {
		const result = validatePageCopy({ ...VALID, tagline: '  Calm   site ', features: ['A', ' ', 'B', 'C'] });
		expect(result).toEqual({ ok: true, value: { ...VALID, tagline: 'Calm site', features: ['A', 'B', 'C'] } });
	});

	it('rejects malformed input', () => {
		expect(validatePageCopy(null)).toEqual({ ok: false, field: null, error: 'Page text is malformed' });
		expect(validatePageCopy({ ...VALID, features: 'one' })).toEqual({ ok: false, field: null, error: 'Page text is malformed' });
		expect(validatePageCopy({ ...VALID, includes: [{ name: 'Home' }] })).toEqual({
			ok: false,
			field: null,
			error: 'Page text is malformed',
		});
	});

	it('holds the tagline to 1-90 characters', () => {
		expect(validatePageCopy({ ...VALID, tagline: repeat(90) }).ok).toBe(true);
		expect(validatePageCopy({ ...VALID, tagline: repeat(91) })).toEqual({
			ok: false,
			field: 'tagline',
			error: 'Keep the tagline to 90 characters or fewer',
		});
		expect(validatePageCopy({ ...VALID, tagline: '  ' })).toEqual({ ok: false, field: 'tagline', error: 'Add a tagline' });
	});

	it('holds About to 1-3 paragraphs and 1,200 characters', () => {
		expect(validatePageCopy({ ...VALID, about: [repeat(400), repeat(400), repeat(400)] }).ok).toBe(true);
		expect(validatePageCopy({ ...VALID, about: [repeat(400), repeat(400), repeat(401)] })).toEqual({
			ok: false,
			field: 'about',
			error: 'Keep About to 1,200 characters or fewer',
		});
		expect(validatePageCopy({ ...VALID, about: [] })).toEqual({
			ok: false,
			field: 'about',
			error: 'Write 1 to 3 paragraphs about the site',
		});
		expect(validatePageCopy({ ...VALID, about: ['a', 'b', 'c', 'd'] }).ok).toBe(false);
	});

	it('holds features to 3-8 items of up to 80 characters', () => {
		expect(validatePageCopy({ ...VALID, features: ['a', 'b'] })).toEqual({
			ok: false,
			field: 'features',
			error: 'List 3 to 8 features',
		});
		expect(validatePageCopy({ ...VALID, features: Array.from({ length: 9 }, (_, i) => `f${i}`) }).ok).toBe(false);
		expect(validatePageCopy({ ...VALID, features: ['a', 'b', repeat(80)] }).ok).toBe(true);
		expect(validatePageCopy({ ...VALID, features: ['a', 'b', repeat(81)] })).toEqual({
			ok: false,
			field: 'features',
			error: 'Keep each feature to 80 characters or fewer',
		});
	});

	it('holds What is included to 1-12 named items', () => {
		const item = { name: repeat(40), detail: repeat(100) };
		expect(validatePageCopy({ ...VALID, includes: [item] }).ok).toBe(true);
		expect(validatePageCopy({ ...VALID, includes: [] })).toEqual({
			ok: false,
			field: 'includes',
			error: 'List 1 to 12 pages or sections',
		});
		expect(validatePageCopy({ ...VALID, includes: Array.from({ length: 13 }, () => ({ name: 'a', detail: 'b' })) }).ok).toBe(false);
		const tooLong = 'Give each page or section a name of up to 40 characters and a line of up to 100';
		expect(validatePageCopy({ ...VALID, includes: [{ name: repeat(41), detail: 'b' }] })).toEqual({
			ok: false,
			field: 'includes',
			error: tooLong,
		});
		expect(validatePageCopy({ ...VALID, includes: [{ name: 'a', detail: '' }] })).toEqual({
			ok: false,
			field: 'includes',
			error: tooLong,
		});
	});

	it('holds Made for to 2-5 items of up to 40 characters', () => {
		expect(validatePageCopy({ ...VALID, madeFor: ['a'] })).toEqual({
			ok: false,
			field: 'madeFor',
			error: 'List 2 to 5 kinds of people or businesses it is made for',
		});
		expect(validatePageCopy({ ...VALID, madeFor: ['a', 'b', 'c', 'd', 'e', 'f'] }).ok).toBe(false);
		expect(validatePageCopy({ ...VALID, madeFor: ['a', repeat(41)] })).toEqual({
			ok: false,
			field: 'madeFor',
			error: 'Keep each "Made for" item to 40 characters or fewer',
		});
	});
});

describe('samePageCopy and parseStoredPageCopy', () => {
	it('compares normalized text, and treats two empty values as equal', () => {
		expect(samePageCopy(VALID, { ...VALID, tagline: ` ${VALID.tagline} ` })).toBe(true);
		expect(samePageCopy(VALID, { ...VALID, features: [...VALID.features].reverse() })).toBe(false);
		expect(samePageCopy(null, null)).toBe(true);
		expect(samePageCopy(VALID, null)).toBe(false);
	});

	it('reads stored JSON and ignores anything unreadable', () => {
		expect(parseStoredPageCopy(JSON.stringify(VALID))).toEqual(VALID);
		expect(parseStoredPageCopy(null)).toBeNull();
		expect(parseStoredPageCopy('{not json')).toBeNull();
		expect(parseStoredPageCopy('{"tagline":1}')).toBeNull();
		expect(normalizePageCopy({ ...VALID, extra: true })).toEqual(VALID);
	});
});
