/** Catalog price locks for checkout, from the catalog's current offers. */

import { lockCatalogPrices } from '../catalog/offers';
import type { CatalogLock } from './pricing';

export function lockCatalogPricesFor(env: Env, catalogVariantIds: readonly string[], shipToCountry: string): Promise<readonly CatalogLock[]> {
	return lockCatalogPrices(env, { catalogVariantIds, shipToCountry });
}
