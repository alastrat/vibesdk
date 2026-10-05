import { BRAND } from '../../shared/brand';

/** Document title for a page: "<page> - Estori", or "Estori" with no page. */
export function pageTitle(page?: string): string {
	const trimmed = page?.trim();
	return trimmed ? `${trimmed} - ${BRAND.name}` : BRAND.name;
}
