/** Catalog prices locked for checkout, from the refreshed offers. Stale or unavailable offers never sell. */

import { CATALOG_DESTINATIONS } from '../../../shared/types/catalog';
import { CatalogProductService } from '../../database';
import type { CatalogLock } from '../store-payments/pricing';
import type { OfferLookup } from './catalog-store';
import { CATALOG_OFFER_MAX_AGE_MS } from './config';

export function lockFromLookup(lookup: OfferLookup | undefined, catalogVariantId: string, nowMs: number): CatalogLock {
	if (!lookup) return { ok: false, catalogVariantId, reason: 'unknown' };
	const offer = lookup.offer;
	if (!offer) return { ok: false, catalogVariantId, reason: 'ships_to_unsupported' };
	const stale = nowMs - offer.updatedAt.getTime() > CATALOG_OFFER_MAX_AGE_MS;
	if (!offer.available || offer.catalogPriceCents === null || stale) return { ok: false, catalogVariantId, reason: 'unavailable' };
	return { ok: true, catalogVariantId, supplier: 'cjdropshipping', supplierVariantId: lookup.supplierVariantId, lockedCatalogPriceCents: offer.catalogPriceCents };
}

export async function lockCatalogPrices(env: Env, input: { catalogVariantIds: readonly string[]; shipToCountry: string }): Promise<readonly CatalogLock[]> {
	if (!CATALOG_DESTINATIONS[input.shipToCountry]) {
		return input.catalogVariantIds.map((catalogVariantId) => ({ ok: false, catalogVariantId, reason: 'ships_to_unsupported' }));
	}
	const lookups = await new CatalogProductService(env).lookupOffers(input.catalogVariantIds, input.shipToCountry);
	const byId = new Map(lookups.map((lookup) => [lookup.catalogVariantId, lookup]));
	const nowMs = Date.now();
	return input.catalogVariantIds.map((catalogVariantId) => lockFromLookup(byId.get(catalogVariantId), catalogVariantId, nowMs));
}
