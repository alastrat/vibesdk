import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, INTL_LOCALE, LOCALES, LOCALE_AI_NAMES, LOCALE_NAMES, isLocale, localeFromAcceptLanguage, negotiateLocale } from './locales';

describe('the locale table', () => {
	it('lists English first, then Latin American Spanish and Brazilian Portuguese', () => {
		expect(LOCALES).toEqual(['en', 'es', 'pt-BR']);
		expect(DEFAULT_LOCALE).toBe('en');
	});

	it('names each language in itself for the picker, and in English for the AI', () => {
		expect(LOCALE_NAMES).toEqual({ en: 'English', es: 'Español', 'pt-BR': 'Português (Brasil)' });
		expect(LOCALE_AI_NAMES).toEqual({ en: 'English', es: 'Latin American Spanish', 'pt-BR': 'Brazilian Portuguese' });
	});

	it('formats Spanish as Latin American, so numbers read 100,000 as in Mexico', () => {
		expect(INTL_LOCALE).toEqual({ en: 'en-US', es: 'es-419', 'pt-BR': 'pt-BR' });
		for (const locale of LOCALES) expect(Intl.NumberFormat.supportedLocalesOf(INTL_LOCALE[locale])).toEqual([INTL_LOCALE[locale]]);
	});
});

describe('isLocale', () => {
	it('accepts exactly the supported codes', () => {
		for (const locale of LOCALES) expect(isLocale(locale)).toBe(true);
		for (const bad of ['fr', 'es-MX', 'pt', 'EN', '', 'toString', 'constructor', null, undefined, 1, {}, ['en']]) expect(isLocale(bad)).toBe(false);
	});
});

describe('negotiateLocale', () => {
	it('sends any Portuguese to Brazilian Portuguese', () => {
		expect(negotiateLocale(['pt-PT'])).toBe('pt-BR');
		expect(negotiateLocale(['pt'])).toBe('pt-BR');
		expect(negotiateLocale(['pt-br'])).toBe('pt-BR');
	});

	it('sends any Spanish to Latin American Spanish, and takes the first language that matches', () => {
		expect(negotiateLocale(['es-ES', 'en'])).toBe('es');
		expect(negotiateLocale(['es-MX'])).toBe('es');
		expect(negotiateLocale(['fr', 'es'])).toBe('es');
		expect(negotiateLocale(['en-GB', 'es'])).toBe('en');
	});

	it('falls back to English for anything else', () => {
		expect(negotiateLocale(['fr', 'de'])).toBe('en');
		expect(negotiateLocale([])).toBe('en');
		expect(negotiateLocale(['*'])).toBe('en');
	});

	it('matches the language, not a prefix of it', () => {
		expect(negotiateLocale(['est'])).toBe('en');
		expect(negotiateLocale(['ptx-BR'])).toBe('en');
		expect(negotiateLocale(['es_MX'])).toBe('es');
	});
});

describe('localeFromAcceptLanguage', () => {
	it('answers English without a header', () => {
		expect(localeFromAcceptLanguage(null)).toBe('en');
		expect(localeFromAcceptLanguage('')).toBe('en');
	});

	it('ranks by q-value, then by position', () => {
		expect(localeFromAcceptLanguage('fr;q=0.9, pt-BR;q=0.8')).toBe('pt-BR');
		expect(localeFromAcceptLanguage('en;q=0.5, es;q=0.9')).toBe('es');
		expect(localeFromAcceptLanguage('pt;q=0.8, es;q=0.8')).toBe('pt-BR');
		expect(localeFromAcceptLanguage('es-MX,es;q=0.9,en-US;q=0.8,en;q=0.7')).toBe('es');
		expect(localeFromAcceptLanguage('en-US,en;q=0.9,es;q=0.8')).toBe('en');
	});

	it('ignores languages the client refuses (q=0) and entries it cannot read', () => {
		expect(localeFromAcceptLanguage('es;q=0, pt-BR;q=0.1')).toBe('pt-BR');
		expect(localeFromAcceptLanguage('es;q=abc, pt;q=0.4')).toBe('pt-BR');
		expect(localeFromAcceptLanguage(',,;q=1, *')).toBe('en');
	});

	it('reads spacing and case loosely', () => {
		expect(localeFromAcceptLanguage('  FR ; Q=0.9 ,PT-br ; q=0.8')).toBe('pt-BR');
	});
});
