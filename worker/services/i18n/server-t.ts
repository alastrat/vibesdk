/** The server's translations: both catalogs are bundled, so any code that words text for a seller can translate it. */

import es from '../../../shared/i18n/catalogs/es.json';
import ptBR from '../../../shared/i18n/catalogs/pt-BR.json';
import type { Locale } from '../../../shared/i18n/locales';
import { translatorFor, type Catalog, type Translator } from '../../../shared/i18n/translate';

const CATALOGS: Record<Locale, Catalog | null> = { en: null, es, 'pt-BR': ptBR };

const translators = new Map<Locale, Translator>();

/** A `Translator` for `locale`, which is English wherever no translation exists. */
export function serverT(locale: Locale): Translator {
	let translator = translators.get(locale);
	if (translator === undefined) {
		translator = translatorFor(CATALOGS[locale], locale);
		translators.set(locale, translator);
	}
	return translator;
}
