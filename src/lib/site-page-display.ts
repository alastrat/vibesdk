import { formatTemplatePrice, type SitePageData } from '@/api-types';

/** The price a product page shows: null for a paid site whose first price isn't approved yet. */
export function sitePriceLabel(page: Pick<SitePageData, 'paid' | 'priceCents'>): string | null {
	if (page.priceCents !== null) return formatTemplatePrice(page.priceCents);
	return page.paid ? null : 'Free';
}
