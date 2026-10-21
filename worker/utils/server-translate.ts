/** Estori's own words in a language, for messages the server answers with, such as a refusal the seller reads. */

import es from '../../shared/i18n/catalogs/es.json';
import ptBR from '../../shared/i18n/catalogs/pt-BR.json';
import type { Locale } from '../../shared/i18n/locales';
import { translate, type Catalog, type MessageValues } from '../../shared/i18n/translate';
import { LocalePreferenceService } from '../database/services/LocalePreferenceService';

/** English is the source text and has no catalog. */
const CATALOGS: Readonly<Record<Locale, Catalog | null>> = { en: null, es, 'pt-BR': ptBR };

/** The English text `english` in `locale`, with `{values}` filled in; English where the catalog has no translation. Mark `english` with `msg()` so the extractor finds it. */
export function translateFor(locale: Locale, english: string, values?: MessageValues): string {
	return translate(CATALOGS[locale], english, values);
}

/** The language the user saved in the app; English when they never chose one. */
export async function localeOfUser(env: Env, userId: string): Promise<Locale> {
	return (await new LocalePreferenceService(env).locale(userId)) ?? 'en';
}

/**
 * `english` in the user's saved language. `values` may be a function of that language, for a value written its way, such
 * as a number grouped as the language groups it.
 */
export async function translateForUser(env: Env, userId: string, english: string, values?: MessageValues | ((locale: Locale) => MessageValues)): Promise<string> {
	const locale = await localeOfUser(env, userId);
	return translateFor(locale, english, typeof values === 'function' ? values(locale) : values);
}
