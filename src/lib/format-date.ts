import { format } from 'date-fns';
import { perLocale } from '../../shared/i18n/format';
import type { Locale } from '../../shared/i18n/locales';
import { dateFnsLocale } from './i18n/date-locale';

const longDate = perLocale((intl) => new Intl.DateTimeFormat(intl, { year: 'numeric', month: 'long', day: 'numeric' }));
const shortDate = perLocale((intl) => new Intl.DateTimeFormat(intl, { year: 'numeric', month: 'short', day: 'numeric' }));

/** "October 21, 2026", "21 de octubre de 2026": the day in the viewer's time zone. */
export function formatLongDate(date: Date, locale: Locale): string {
	return longDate(locale).format(date);
}

/** "Oct 21, 2026", "21 oct 2026". */
export function formatShortDate(date: Date, locale: Locale): string {
	return shortDate(locale).format(date);
}

/** "Oct 21, 2026 3:45 PM", "21 oct 2026 15:45": the time as the language writes it, on a 12 or a 24 hour clock. */
export function formatShortDateTime(date: Date, locale: Locale): string {
	return `${formatShortDate(date, locale)} ${format(date, 'p', { locale: dateFnsLocale(locale) })}`;
}

const numericDate = perLocale((intl) => new Intl.DateTimeFormat(intl));

/** "10/21/2026", "21/10/2026": the date the way the language writes it in tables. */
export function formatNumericDate(date: Date, locale: Locale): string {
	return numericDate(locale).format(date);
}
