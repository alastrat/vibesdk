import { describe, expect, it } from 'vitest';
import { parseGalleryQuery } from './galleryQuery';

describe('parseGalleryQuery', () => {
	it('applies the public listing defaults', () => {
		expect(parseGalleryQuery(new URLSearchParams())).toEqual({
			ok: true,
			value: { limit: 20, page: 1, offset: 0, search: undefined, category: undefined },
		});
	});

	it('accepts a known category and a search term', () => {
		expect(parseGalleryQuery(new URLSearchParams({ category: 'store', search: 'socks', page: '2', limit: '12' }))).toEqual({
			ok: true,
			value: { limit: 12, page: 2, offset: 12, search: 'socks', category: 'store' },
		});
	});

	it('rejects an unknown category', () => {
		expect(parseGalleryQuery(new URLSearchParams({ category: 'blog' }))).toEqual({ ok: false, error: 'Unknown category' });
	});

	it('keeps the public listing bounds on search', () => {
		expect(parseGalleryQuery(new URLSearchParams({ search: '100%' }))).toEqual({
			ok: false,
			error: 'search may not contain wildcard characters',
		});
	});
});
