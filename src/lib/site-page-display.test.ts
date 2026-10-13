import { describe, expect, it } from 'vitest';
import { sitePriceLabel } from './site-page-display';

describe('sitePriceLabel', () => {
	it('shows the approved price of a paid site', () => {
		expect(sitePriceLabel({ paid: true, priceCents: 2900 })).toBe('$29');
	});

	it('shows no price for a paid site that has not been approved yet', () => {
		expect(sitePriceLabel({ paid: true, priceCents: null })).toBeNull();
	});

	it('labels a free site Free', () => {
		expect(sitePriceLabel({ paid: false, priceCents: null })).toBe('Free');
	});
});
