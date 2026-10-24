import { describe, expect, it } from 'vitest';
import { storeListCsv } from './store-list-export';

describe('store list CSV', () => {
	it('quotes commas, quotes and line breaks, with Unicode support', () => {
		expect(storeListCsv(['Store'], [['Café, "tea"\nshop']])).toBe(
			'\uFEFF"Store"\r\n"Café, ""tea""\nshop"\r\n',
		);
	});
	it.each([
		'=1+1',
		' +SUM(A1)',
		'-42',
		'@cmd',
		'\tplain',
		'\n=1',
		'\uFEFF=2',
	])('neutralizes spreadsheet formulas and control prefixes: %s', (title) => {
		expect(storeListCsv(['Store'], [[title]])).toContain(`"'${title}"`);
	});
});
