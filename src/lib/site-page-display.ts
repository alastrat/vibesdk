import { t, getLocale } from '@/lib/i18n';
import { formatTemplatePrice, type SitePageData } from '@/api-types';

/** The price a product page shows: null for a paid site whose first price isn't approved yet. */
export function sitePriceLabel(page: Pick<SitePageData, 'paid' | 'priceCents'>): string | null {
	if (page.priceCents !== null) return formatTemplatePrice(page.priceCents, getLocale(), t('Free'));
	return page.paid ? null : t('Free');
}
