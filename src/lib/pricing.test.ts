import { describe, expect, it } from 'vitest';
import { TEMPLATE_PRICE_OPTIONS_CENTS } from '@/api-types';
import { platformFeeCents } from '../../shared/types/templates';
import { EXAMPLE_SALE_CENTS, formatCents, sellerKeepsCents, sellerKeepsTable } from './pricing';

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

	it('shows the creators panel an example sale at a real price, with what the seller keeps from the fee code', () => {
		expect(TEMPLATE_PRICE_OPTIONS_CENTS).toContain(EXAMPLE_SALE_CENTS);
		expect(sellerKeepsCents(EXAMPLE_SALE_CENTS)).toBe(2637);
	});
});

describe('formatCents', () => {
	it('shows dollars with cents', () => {
		expect(formatCents(2637)).toBe('$26.37');
		expect(formatCents(900)).toBe('$9.00');
	});

	it('keeps English exactly as it was, even for amounts the other languages would group or sign differently', () => {
		expect(formatCents(2637, 'en')).toBe('$26.37');
		expect(formatCents(123_450)).toBe('$1234.50');
		expect(formatCents(-300)).toBe('$-3.00');
	});

	it('always shows the cents, in the language\'s own marks', () => {
		const nbsp = '\u00a0';
		expect(formatCents(900, 'es')).toBe(`USD${nbsp}9.00`);
		expect(formatCents(900, 'pt-BR')).toBe(`US$${nbsp}9,00`);
		expect(formatCents(2637, 'pt-BR')).toBe(`US$${nbsp}26,37`);
		expect(formatCents(123_450, 'es')).toBe(`USD${nbsp}1,234.50`);
		expect(formatCents(123_450, 'pt-BR')).toBe(`US$${nbsp}1.234,50`);
		expect(formatCents(-300, 'pt-BR')).toBe(`-US$${nbsp}3,00`);
	});
});
