import { describe, expect, it } from 'vitest';
import { usdToCents } from './money';

describe('usdToCents', () => {
	it('reads decimal dollars exactly, as strings or numbers', () => {
		expect(usdToCents('4.27')).toBe(427);
		expect(usdToCents('0.1')).toBe(10);
		expect(usdToCents('16.90')).toBe(1690);
		expect(usdToCents(16.9)).toBe(1690);
		expect(usdToCents('12')).toBe(1200);
		expect(usdToCents(0)).toBe(0);
	});

	it('rounds a third decimal half up', () => {
		expect(usdToCents('3.994')).toBe(399);
		expect(usdToCents('3.995')).toBe(400);
	});

	it('refuses anything that is not one amount', () => {
		for (const value of ['', 'abc', '-1', '38.15 -- 38.20', '1e3', Number.NaN]) expect(usdToCents(value)).toBeNull();
	});
});
