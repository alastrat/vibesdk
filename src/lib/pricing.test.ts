import { describe, expect, it } from 'vitest';
import { TEMPLATE_PRICE_OPTIONS_CENTS, platformFeeCents } from '../../shared/types/templates';
import { formatCents, sellerKeepsTable } from './pricing';

describe('sellerKeepsTable', () => {
	it('lists every paid price with what the seller keeps after the fee', () => {
		const rows = sellerKeepsTable();
		expect(rows.map((row) => row.priceCents)).toEqual(TEMPLATE_PRICE_OPTIONS_CENTS.filter((price) => price > 0));
		for (const row of rows) {
			expect(row.feeCents).toBe(platformFeeCents(row.priceCents));
			expect(row.sellerCents).toBe(row.priceCents - row.feeCents);
		}
		expect(rows.find((row) => row.priceCents === 2900)?.sellerCents).toBe(2637);
	});
});

describe('formatCents', () => {
	it('shows dollars with cents', () => {
		expect(formatCents(2637)).toBe('$26.37');
		expect(formatCents(900)).toBe('$9.00');
	});
});
