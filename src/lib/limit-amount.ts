import type { LimitConfig } from '@/hooks/use-limits';
import { formatDollars, formatNumber, perLocale } from '../../shared/i18n/format';
import type { Locale } from '../../shared/i18n/locales';

const compactNumbers = perLocale((intl) => new Intl.NumberFormat(intl, { notation: 'compact', maximumFractionDigits: 0 }));

/** An amount of a usage limit the way the language writes it: "12K" or "12 mil" tokens, "$1.50" dollars, "136" or "1.5" otherwise. */
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
