import { describe, expect, it } from 'vitest';
import { LOCALES } from '../../shared/i18n/locales';
import { formatLimitAmount, formatMoney } from './limit-amount';

/** `Intl` separates a symbol from its amount with a no-break space in some languages; the tests read it as a space. */
const plain = (text: string) => text.replace(/ /g, ' ');

describe('formatLimitAmount', () => {
	it('writes tokens in the language\'s compact form', () => {
		expect(formatLimitAmount('tokens', 12_000, 'en')).toBe('12K');
		expect(formatLimitAmount('tokens', 1_000, 'en')).toBe('1K');
		expect(plain(formatLimitAmount('tokens', 12_000, 'es'))).toBe('12 k');
		expect(plain(formatLimitAmount('tokens', 1_000, 'es'))).toBe('1 K');
		expect(plain(formatLimitAmount('tokens', 12_000, 'pt-BR'))).toBe('12 mil');
		expect(plain(formatLimitAmount('tokens', 1_000, 'pt-BR'))).toBe('1 mil');
	});

	it('writes a count under a thousand as it is, and a million in the language\'s own letter', () => {
		for (const locale of LOCALES) expect(formatLimitAmount('tokens', 999, locale)).toBe('999');
		expect(formatLimitAmount('tokens', 1_000_000, 'en')).toBe('1M');
		expect(plain(formatLimitAmount('tokens', 1_000_000, 'es'))).toBe('1 M');
		expect(plain(formatLimitAmount('tokens', 1_000_000, 'pt-BR'))).toBe('1 mi');
	});

	it('writes a cost in dollars with cents, the way each language writes US dollars', () => {
		expect(formatLimitAmount('cost', 1.5, 'en')).toBe('$1.50');
		expect(plain(formatLimitAmount('cost', 1.5, 'es'))).toBe('USD 1.50');
		expect(plain(formatLimitAmount('cost', 1.5, 'pt-BR'))).toBe('US$ 1,50');
	});

	it('writes any other amount rounded to a tenth, with the language\'s decimal mark', () => {
		expect(formatLimitAmount('credits', 136, 'en')).toBe('136');
		expect(formatLimitAmount('credits', 1.54, 'en')).toBe('1.5');
		expect(formatLimitAmount('credits', 1.54, 'es')).toBe('1.5');
		expect(formatLimitAmount('credits', 1.54, 'pt-BR')).toBe('1,5');
		expect(formatLimitAmount('credits', 1_234, 'pt-BR')).toBe('1.234');
	});
});

describe('formatMoney', () => {
	it('writes US dollars as formatDollars does', () => {
		expect(formatMoney(61.57, 'USD', 'en')).toBe('$61.57');
		expect(plain(formatMoney(61.57, 'USD', 'es'))).toBe('USD 61.57');
		expect(plain(formatMoney(61.57, 'USD', 'pt-BR'))).toBe('US$ 61,57');
	});

	it('writes euros in each language', () => {
		expect(formatMoney(61.57, 'EUR', 'en')).toBe('€61.57');
		expect(plain(formatMoney(61.57, 'EUR', 'es'))).toBe('EUR 61.57');
		expect(plain(formatMoney(61.57, 'EUR', 'pt-BR'))).toBe('€ 61,57');
	});

	it('writes pounds in each language', () => {
		expect(formatMoney(61.57, 'GBP', 'en')).toBe('£61.57');
		expect(plain(formatMoney(61.57, 'GBP', 'es'))).toBe('GBP 61.57');
		expect(plain(formatMoney(61.57, 'GBP', 'pt-BR'))).toBe('£ 61,57');
	});

	it('falls back to the number and the code for a currency Intl does not know', () => {
		expect(formatMoney(61.57, 'not-a-currency', 'en')).toBe('61.57 not-a-currency');
		expect(formatMoney(1234.5, 'not-a-currency', 'pt-BR')).toBe('1.234,5 not-a-currency');
	});
});
