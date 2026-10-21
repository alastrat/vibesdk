import type { LimitConfig } from '@/hooks/use-limits';
import { formatDollars, formatNumber, perLocale } from '../../shared/i18n/format';
import { INTL_LOCALE, type Locale } from '../../shared/i18n/locales';

const compactNumbers = perLocale((intl) => new Intl.NumberFormat(intl, { notation: 'compact', maximumFractionDigits: 0 }));

/**
 * An amount of a usage limit the way the language writes it: "$1.50" dollars, "136" or "1.5" otherwise, and tokens in
 * `Intl`'s compact form, which is the language's own: "12K" in English, "12 k" in Spanish (es-419 writes "1 K" for a
 * thousand and "12 k" above it) and "12 mil" in Portuguese, the only one of the three that spells it out.
 */
export function formatLimitAmount(type: LimitConfig['type'], value: number, locale: Locale): string {
	switch (type) {
		case 'tokens':
			return compactNumbers(locale).format(value);
		case 'cost':
			return formatDollars(value, locale, 'always');
		default:
			return formatNumber(Math.round(value * 10) / 10, locale);
	}
}

/** Money the way the language writes it: US dollars as '$61.57', 'USD 61.57' or 'US$ 61,57', other currencies by their own symbol. */
export function formatMoney(amount: number, currency: string, locale: Locale): string {
	if (currency === 'USD') return formatDollars(amount, locale, 'always');
	try {
		return new Intl.NumberFormat(INTL_LOCALE[locale], { style: 'currency', currency }).format(amount);
	} catch {
		// A currency code Intl does not know.
		return `${formatNumber(amount, locale)} ${currency}`;
	}
}
