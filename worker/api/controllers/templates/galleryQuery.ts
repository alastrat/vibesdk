/**
 * Bounds for the public template gallery query. Paging and search reuse the
 * public apps limits; the category must be a known one.
 */

import type { TemplateCategory } from '../../../../shared/types/templates';
import { isTemplateCategory, type Validation } from '../../../services/templates/catalog';
import { parsePublicAppsQuery } from '../apps/publicAppsQuery';

export interface GalleryQuery {
	limit: number;
	page: number;
	offset: number;
	search?: string;
	category?: TemplateCategory;
}

export function parseGalleryQuery(params: URLSearchParams): Validation<GalleryQuery> {
	const bounds = parsePublicAppsQuery(params);
	if (!bounds.ok) return { ok: false, error: bounds.error };

	const rawCategory = params.get('category') || undefined;
	if (rawCategory !== undefined && !isTemplateCategory(rawCategory)) {
		return { ok: false, error: 'Unknown category' };
	}
	return { ok: true, value: { ...bounds.value, category: rawCategory } };
}
