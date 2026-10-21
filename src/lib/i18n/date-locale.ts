import type { Locale as DateFnsLocale } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import { es } from 'date-fns/locale/es';
import { ptBR } from 'date-fns/locale/pt-BR';
import type { Locale } from '@/api-types';

const DATE_FNS_LOCALES: Record<Locale, DateFnsLocale> = { en: enUS, es, 'pt-BR': ptBR };

/** The `date-fns` locale that writes month names and relative times in the app's language. */
export function dateFnsLocale(locale: Locale): DateFnsLocale {
	return DATE_FNS_LOCALES[locale];
}
