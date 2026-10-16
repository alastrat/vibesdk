/**
 * Catalog price locks for checkout. Catalog lines are refused until the catalog connection supplies prices, as the
 * checkout spec rules: "catalog lines are designed in here but refused until the catalog ships".
 */

import type { CatalogLock } from './pricing';

export async function lockCatalogPricesFor(_env: Env, catalogVariantIds: readonly string[], _shipToCountry: string): Promise<readonly CatalogLock[]> {
	return catalogVariantIds.map((catalogVariantId) => ({ ok: false, catalogVariantId, reason: 'unknown' }));
}
