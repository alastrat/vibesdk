import type { Locale } from '@/api-types';
import type { Catalog } from '../../../shared/i18n/translate';

/** Each catalog is a chunk of its own, fetched the first time its language is chosen. */
const CATALOGS: Record<Exclude<Locale, 'en'>, () => Promise<{ default: Catalog }>> = {
	es: () => import('../../../shared/i18n/catalogs/es.json'),
	'pt-BR': () => import('../../../shared/i18n/catalogs/pt-BR.json'),
};

/** A language's translations; null for English, whose text is the source and needs no catalog. */
export async function loadCatalog(locale: Locale): Promise<Catalog | null> {
	if (locale === 'en') return null;
	return (await CATALOGS[locale]()).default;
}
