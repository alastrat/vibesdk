/** Catalog rows as the seller's page and the store agent see them. Only active products and variants, US prices. */

import {
	minimumRetailPriceCents,
	suggestedRetailPriceCents,
	type CatalogProductStatus,
	type CatalogProductView,
	type CatalogVariantStatus,
	type CatalogVariantView,
} from '../../../shared/types/catalog';
import { CATALOG_OFFER_MAX_AGE_MS } from './config';

const VIEW_COUNTRY = 'US';

export interface CatalogRows {
	product: { id: string; title: string | null; description: string | null; category: string; images: string[]; status: CatalogProductStatus };
	variants: Array<{ id: string; name: string; options: Record<string, string>; imageKey: string | null; status: CatalogVariantStatus }>;
	offers: Array<{ variantId: string; destinationCountry: string; available: boolean; catalogPriceCents: number | null; deliveryDaysMin: number | null; deliveryDaysMax: number | null; updatedAt: Date }>;
}

/** A variant without the catalog price, for the store agent: it writes retail prices only. */
export type AgentCatalogVariant = Omit<CatalogVariantView, 'catalogPriceCents'>;
export type AgentCatalogProduct = Omit<CatalogProductView, 'variants'> & { variants: AgentCatalogVariant[] };

export function catalogProductView(rows: CatalogRows, imageUrl: (key: string) => string, nowMs: number): CatalogProductView | null {
	if (rows.product.status !== 'active') return null;
	const variants = rows.variants
		.filter((variant) => variant.status === 'active')
		.map((variant): CatalogVariantView => {
			const offer = rows.offers.find((candidate) => candidate.variantId === variant.id && candidate.destinationCountry === VIEW_COUNTRY);
			const fresh = offer !== undefined && nowMs - offer.updatedAt.getTime() <= CATALOG_OFFER_MAX_AGE_MS;
			const price = offer && fresh && offer.available ? offer.catalogPriceCents : null;
			return {
				catalogVariantId: variant.id,
				name: variant.name,
				options: variant.options,
				imageUrl: variant.imageKey ? imageUrl(variant.imageKey) : null,
				available: price !== null,
				deliveryDays: price !== null && offer ? { min: offer.deliveryDaysMin, max: offer.deliveryDaysMax } : null,
				catalogPriceCents: price,
				minimumRetailPriceCents: price === null ? null : minimumRetailPriceCents(price),
				suggestedRetailPriceCents: price === null ? null : suggestedRetailPriceCents(price),
			};
		});
	return {
		productId: rows.product.id,
		title: rows.product.title ?? 'Untitled product',
		description: rows.product.description ?? '',
		category: rows.product.category,
		imageUrls: rows.product.images.map(imageUrl),
		shipsTo: variants.some((variant) => variant.available) ? [VIEW_COUNTRY] : [],
		variants,
	};
}

export function agentProductView(view: CatalogProductView): AgentCatalogProduct {
	return { ...view, variants: view.variants.map(({ catalogPriceCents: _catalogPriceCents, ...variant }) => variant) };
}
