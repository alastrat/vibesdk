/** What the catalog refresh and checkout read and write, independent of D1 so they are tested with fakes. */

import type { CatalogOfferUnavailableReason, CatalogProductStatus, CatalogVariantStatus } from '../../../shared/types/catalog';

export interface CuratedProduct {
	supplierProductId: string;
	category: string;
	/** Replaces the supplier's title when set. */
	title?: string;
	paused?: boolean;
}

export interface ClaimedProduct {
	id: string;
	supplierProductId: string;
	status: CatalogProductStatus;
	title: string | null;
	imageKeys: string[];
}

export interface RefreshedVariant {
	supplierVariantId: string;
	sku: string | null;
	name: string;
	options: Record<string, string>;
	imageKey: string | null;
	weightGrams: number;
	supplierCostCents: number;
	stock: Record<string, number>;
	status: CatalogVariantStatus;
}

export interface RefreshedOffer {
	supplierVariantId: string;
	destinationCountry: string;
	originCountry: string;
	logisticName: string | null;
	deliveryDaysMin: number | null;
	deliveryDaysMax: number | null;
	supplierCostCents: number;
	shippingCents: number | null;
	catalogPriceCents: number | null;
	available: boolean;
	unavailableReason: CatalogOfferUnavailableReason | null;
}

export interface RefreshedProduct {
	productId: string;
	title: string;
	description: string;
	category: string | null;
	imageKeys: string[];
	attributes: Record<string, string>;
	variants: RefreshedVariant[];
	offers: RefreshedOffer[];
	refreshedAt: Date;
}

export interface OfferLookup {
	catalogVariantId: string;
	supplierVariantId: string;
	/** Null when the variant has no offer for the destination. */
	offer: { available: boolean; catalogPriceCents: number | null; updatedAt: Date } | null;
}

export interface CatalogRefreshStore {
	ensureCurated(entries: readonly CuratedProduct[], now: Date): Promise<void>;
	claimForRefresh(limit: number, now: Date): Promise<ClaimedProduct[]>;
	saveRefresh(product: RefreshedProduct): Promise<void>;
	/** `retire` stops selling the product: the supplier removed it. */
	recordRefreshError(productId: string, message: string, now: Date, retire: boolean): Promise<void>;
}
