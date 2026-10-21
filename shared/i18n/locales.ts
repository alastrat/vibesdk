/** The languages Estori's app speaks. English is the source language and the default. */
export const LOCALES = ['en', 'es', 'pt-BR'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Each language's name in itself, as the picker shows it. */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', es: 'Español', 'pt-BR': 'Português (Brasil)' };

/** Each language's name in English, for telling the AI which language to reply in. */
export const LOCALE_AI_NAMES: Record<Locale, string> = { en: 'English', es: 'Latin American Spanish', 'pt-BR': 'Brazilian Portuguese' };

/** The `Intl` locale that formats numbers, money and dates for each language. */
export const INTL_LOCALE: Record<Locale, string> = { en: 'en-US', es: 'es-419', 'pt-BR': 'pt-BR' };

export function isLocale(value: unknown): value is Locale {
	return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Any Spanish is Latin American Spanish and any Portuguese is Brazilian; the first language that matches wins. */
const LANGUAGE_LOCALES: Readonly<Record<string, Locale>> = { en: 'en', es: 'es', pt: 'pt-BR' };

function localeOfTag(tag: string): Locale | null {
	const language = tag.trim().toLowerCase().split(/[-_]/)[0] ?? '';
	return Object.hasOwn(LANGUAGE_LOCALES, language) ? LANGUAGE_LOCALES[language] : null;
}

/** The app language for a list of preferred language tags, best first, such as `navigator.languages`. */
export function negotiateLocale(preferred: readonly string[]): Locale {
	for (const tag of preferred) {
		const locale = localeOfTag(tag);
		if (locale !== null) return locale;
	}
	return DEFAULT_LOCALE;
}

const QUALITY_PARAM = /^q\s*=\s*(.*)$/i;
const QUALITY_VALUE = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

/** A language range's weight: 1 when it names none, and 0 (refused) when the one it names can't be read. */
function qualityOf(params: readonly string[]): number {
	for (const param of params) {
		const named = QUALITY_PARAM.exec(param.trim());
		if (named === null) continue;
		const value = named[1].trim();
		return QUALITY_VALUE.test(value) ? Number(value) : 0;
	}
	return 1;
}

/**
 * The app languages an `Accept-Language` header accepts, best first: ranges ordered by q-value, then by position,
 * each matched by its base language (`es-MX` is `es`, `pt` is `pt-BR`), each language once. Empty when none match.
 */
export function acceptedLocales(header: string | null): Locale[] {
	if (!header) return [];
	const ranked = header
		.split(',')
		.map((range, position) => {
			const [tag = '', ...params] = range.split(';');
			return { tag: tag.trim(), quality: qualityOf(params), position };
		})
		.filter((range) => range.tag !== '' && range.quality > 0)
		.sort((a, b) => b.quality - a.quality || a.position - b.position);
	const locales = ranked.map((range) => localeOfTag(range.tag)).filter((locale): locale is Locale => locale !== null);
	return [...new Set(locales)];
}

/** The app language for an `Accept-Language` header: its best accepted language, or the default. */
export function localeFromAcceptLanguage(header: string | null): Locale {
	return acceptedLocales(header)[0] ?? DEFAULT_LOCALE;
}
