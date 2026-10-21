/** Estori's own words in a language, for messages the server answers with, such as a refusal the seller reads. */

import type { Locale } from '../../shared/i18n/locales';
import type { MessageValues } from '../../shared/i18n/translate';
import { LocalePreferenceService } from '../database/services/LocalePreferenceService';
import { serverT } from '../services/i18n/server-t';

/** The English text `english` in `locale`, with `{values}` filled in; English where the catalog has no translation. Mark `english` with `msg()` so the extractor finds it. */
export function translateFor(locale: Locale, english: string, values?: MessageValues): string {
	return serverT(locale).t(english, values);
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
