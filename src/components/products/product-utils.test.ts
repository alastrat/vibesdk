import { describe, expect, it } from 'vitest';
import { csvCell, validateProductDraft } from './product-utils';
describe('private product editing', () => {
	it('rejects a sub-minimum price and fractional cents', () => {
		expect(validateProductDraft('Coffee', ['0.49'])).toBeTruthy();
		expect(validateProductDraft('Coffee', ['1.001'])).toBeTruthy();
		expect(validateProductDraft('Coffee', ['0.50', '12.99'])).toBeNull();
	});
	it('requires a name and a variant', () => {
		expect(validateProductDraft('', ['1'])).toBeTruthy();
		expect(validateProductDraft('Coffee', [])).toBeTruthy();
	});
	it('escapes CSV quotes and spreadsheet formulas', () => {
		expect(csvCell('a,"b"')).toBe('"a,""b"""');
		expect(csvCell('=SUM(A1)')).toBe('"\'=SUM(A1)"');
	});
});
