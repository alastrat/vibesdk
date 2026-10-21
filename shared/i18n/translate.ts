import { formatNumber, perLocale } from './format';
import type { Locale } from './locales';

/** A translation: one string, or the two forms of a plural. */
export type CatalogEntry = string | { one: string; other: string };

/** A language's translations, keyed by the English text; a plural is keyed by `singular|plural`. */
export type Catalog = Readonly<Record<string, CatalogEntry>>;

export type MessageValues = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{([A-Za-z_]\w*)\}/g;

const pluralRules = perLocale((intl) => new Intl.PluralRules(intl));

/** The names of the `{placeholders}` in a text, each once, in order of first use. */
export function placeholdersOf(text: string): string[] {
	return [...new Set(Array.from(text.matchAll(PLACEHOLDER), (match) => match[1]))];
}

/** Fills `{name}` placeholders in one pass; a placeholder with no value stays as written. */
export function interpolate(text: string, values?: MessageValues): string {
	if (!values) return text;
	return text.replace(PLACEHOLDER, (placeholder, name: string) => (Object.hasOwn(values, name) ? String(values[name]) : placeholder));
}

function entryOf(catalog: Catalog | null, key: string): CatalogEntry | null {
	return catalog !== null && Object.hasOwn(catalog, key) ? catalog[key] : null;
}

/** The text to show for English `english`: its translation when the catalog has one, otherwise the English, with values filled in. */
export function translate(catalog: Catalog | null, english: string, values?: MessageValues): string {
	const entry = entryOf(catalog, english);
	return interpolate(typeof entry === 'string' && entry !== '' ? entry : english, values);
}

/** The key a plural message has in a catalog. */
export function pluralKey(singular: string, plural: string): string {
	return `${singular}|${plural}`;
}

/**
 * The text for a count: the translation's `one` or `other` form by the language's plural rule, so Portuguese counts 0 as
 * singular. Without a translation the English forms are used by English's rule. `{count}` is the count, formatted.
 */
export function translatePlural(catalog: Catalog | null, locale: Locale, singular: string, plural: string, count: number, values?: MessageValues): string {
	const entry = entryOf(catalog, pluralKey(singular, plural));
	const form = typeof entry === 'object' && entry !== null ? entry[pluralRules(locale).select(count) === 'one' ? 'one' : 'other'] : '';
	const text = typeof form === 'string' && form !== '' ? form : pluralRules('en').select(count) === 'one' ? singular : plural;
	return interpolate(text, { ...values, count: formatNumber(count, locale) });
}

/**
 * Translates into one language. Code shared by the app and the server words its text through a `Translator`, so it
 * works wherever it runs: the app hands over `useI18n()`, the server `serverT(locale)`.
 */
export interface Translator {
	locale: Locale;
	t(english: string, values?: MessageValues): string;
	tn(singular: string, plural: string, count: number, values?: MessageValues): string;
}

/** A `Translator` for `locale` over its catalog, which is null for English. */
export function translatorFor(catalog: Catalog | null, locale: Locale): Translator {
	return {
		locale,
		t: (english, values) => translate(catalog, english, values),
		tn: (singular, plural, count, values) => translatePlural(catalog, locale, singular, plural, count, values),
	};
}

/** The source language, which needs no catalog; what English-only pages hand to shared wording. */
export const ENGLISH: Translator = translatorFor(null, 'en');

/** Marks a string for the extractor and answers it unchanged; the server translates it where it answers a request. */
export function msg(english: string): string {
	return english;
}
