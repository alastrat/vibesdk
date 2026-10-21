import { describe, expect, it } from 'vitest';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { LOCALES } from '@/api-types';
import { dateFnsLocale } from './date-locale';

describe('dateFnsLocale', () => {
	const day = new Date(2026, 10, 19);

	it('writes month names in each language', () => {
		expect(format(day, 'MMMM', { locale: dateFnsLocale('en') })).toBe('November');
		expect(format(day, 'MMMM', { locale: dateFnsLocale('es') })).toBe('noviembre');
		expect(format(day, 'MMMM', { locale: dateFnsLocale('pt-BR') })).toBe('novembro');
	});

	it('writes relative times in each language', () => {
		const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
		expect(formatDistanceToNowStrict(threeDaysAgo, { addSuffix: true, locale: dateFnsLocale('en') })).toBe('3 days ago');
		expect(formatDistanceToNowStrict(threeDaysAgo, { addSuffix: true, locale: dateFnsLocale('es') })).toBe('hace 3 días');
		expect(formatDistanceToNowStrict(threeDaysAgo, { addSuffix: true, locale: dateFnsLocale('pt-BR') })).toBe('há 3 dias');
	});

	it('has a locale for every language the app speaks', () => {
		for (const locale of LOCALES) expect(dateFnsLocale(locale).code).toBeTruthy();
	});
});
