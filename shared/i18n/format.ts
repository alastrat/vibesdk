import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from './locales';

/** Builds an `Intl` formatter the first time a language needs it, then reuses it. */
export function perLocale<T>(make: (intlLocale: string) => T): (locale: Locale) => T {
	const made = new Map<Locale, T>();
	return (locale) => {
		let formatter = made.get(locale);
		if (formatter === undefined) {
			formatter = make(INTL_LOCALE[locale]);
			made.set(locale, formatter);
		}
		return formatter;
	};
}

const numbers = perLocale((intl) => new Intl.NumberFormat(intl));
const wholeDollars = perLocale((intl) => new Intl.NumberFormat(intl, { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }));
const dollarsAndCents = perLocale((intl) => new Intl.NumberFormat(intl, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const monthAndDay = perLocale((intl) => new Intl.DateTimeFormat(intl, { month: 'long', day: 'numeric', timeZone: 'UTC' }));

/** A count with the language's grouping: "100,000" in English and Spanish, "100.000" in Portuguese. */
export function formatNumber(value: number, locale: Locale = DEFAULT_LOCALE): string {
	return numbers(locale).format(value);
}

/**
 * An amount of US dollars the way the language writes them: "$49", "USD 49" or "US$ 49", so they can't be mistaken
 * for pesos or reais. With `cents: 'whenPresent'`, a whole-dollar amount drops its cents.
 */
export function formatDollars(dollars: number, locale: Locale = DEFAULT_LOCALE, cents: 'whenPresent' | 'always' = 'whenPresent'): string {
	const format = cents === 'always' || !Number.isInteger(dollars) ? dollarsAndCents(locale) : wholeDollars(locale);
	return format.format(dollars);
}

/** The month and day of a timestamp in UTC, such as "November 19" or "19 de noviembre". */
export function formatMonthDay(ms: number, locale: Locale = DEFAULT_LOCALE): string {
	return monthAndDay(locale).format(ms);
}
