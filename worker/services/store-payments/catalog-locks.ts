/** Catalog price locks for checkout, from the catalog's current offers; every item reads as sold out while the catalog is paused. */

import { lockCatalogPrices } from '../catalog/offers';
import { isFlagOn } from '../posthog/flags';
import type { CatalogLock } from './pricing';

export async function lockCatalogPricesFor(env: Env, catalogVariantIds: readonly string[], shipToCountry: string, sellerUserId: string): Promise<readonly CatalogLock[]> {
	if (await isFlagOn(env, 'catalog-paused', sellerUserId)) {
		return catalogVariantIds.map((catalogVariantId) => ({ ok: false, catalogVariantId, reason: 'unavailable' }));
	}
	return lockCatalogPrices(env, { catalogVariantIds, shipToCountry });
}
