import englishMarketing from '@/content/marketing/en.json';
import { marketingCatalog } from '@/content/marketing/catalog';
import type { Locale } from '@/api-types';
import type { Catalog } from '../../../shared/i18n/translate';

/** Each catalog is a chunk of its own, fetched the first time its language is chosen. */
const CATALOGS: Record<Exclude<Locale, 'en'>, () => Promise<{ default: Catalog }>> = {
	es: () => import('../../../shared/i18n/catalogs/es.json'),
	'pt-BR': () => import('../../../shared/i18n/catalogs/pt-BR.json'),
};

const MARKETING = {
	es: () => import('@/content/marketing/es.json'),
	'pt-BR': () => import('@/content/marketing/pt-BR.json'),
};

const EXTRAS = {
	es: () => import('@/content/marketing/es.extra.json'),
	'pt-BR': () => import('@/content/marketing/pt-BR.extra.json'),
};

/** A language's translations; null for English, whose text is the source and needs no catalog. */
export async function loadCatalog(locale: Locale): Promise<Catalog | null> {
	if (locale === 'en') return null;
	const [app, marketing, extra] = await Promise.all([CATALOGS[locale](), MARKETING[locale](), EXTRAS[locale]()]);
	return { ...app.default, ...extra.default, ...marketingCatalog(englishMarketing, marketing.default) };
}
