import { describe, expect, it } from 'vitest';
import { formatLongDate, formatNumericDate, formatShortDate, formatShortDateTime } from './format-date';

const AFTERNOON = new Date(2026, 9, 21, 15, 45);

describe('dates in the language', () => {
	it('writes them as English did before: month first, a 12 hour clock', () => {
		expect(formatLongDate(AFTERNOON, 'en')).toBe('October 21, 2026');
		expect(formatShortDate(AFTERNOON, 'en')).toBe('Oct 21, 2026');
		expect(formatShortDateTime(AFTERNOON, 'en')).toBe('Oct 21, 2026 3:45 PM');
	});

	it('writes the day first in Spanish and Portuguese, with the month in the language', () => {
		expect(formatLongDate(AFTERNOON, 'es')).toBe('21 de octubre de 2026');
		expect(formatLongDate(AFTERNOON, 'pt-BR')).toBe('21 de outubro de 2026');
		expect(formatShortDate(AFTERNOON, 'es')).toBe('21 oct 2026');
		expect(formatShortDate(AFTERNOON, 'pt-BR')).toBe('21 de out. de 2026');
	});

	it('writes the time on a 24 hour clock in Spanish and Portuguese', () => {
		expect(formatShortDateTime(AFTERNOON, 'es')).toBe('21 oct 2026 15:45');
		expect(formatShortDateTime(AFTERNOON, 'pt-BR')).toBe('21 de out. de 2026 15:45');
	});

	it('writes the numeric date in the order the language uses', () => {
		expect(formatNumericDate(AFTERNOON, 'en')).toBe('10/21/2026');
		expect(formatNumericDate(AFTERNOON, 'es')).toBe('21/10/2026');
		expect(formatNumericDate(AFTERNOON, 'pt-BR')).toBe('21/10/2026');
	});
});
