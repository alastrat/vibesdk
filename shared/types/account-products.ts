/** Private account catalog: distinct from the shared supplier catalog and immutable published prices. */
export type AccountProductType = 'physical' | 'digital';
export type ProductVisibility = 'visible' | 'hidden';
export interface ProductAsset {
	id: string;
	name: string;
	contentType: string;
	size: number;
	kind: 'image' | 'download';
	url: string;
}
export interface AccountProductVariant {
	id: string;
	name: string;
	priceCents: number;
	sku: string;
	available: boolean;
	catalogVariantId?: string;
}
export interface AccountProduct {
	id: string;
	name: string;
	description: string;
	category: string;
	type: AccountProductType;
	source: 'own' | 'catalog';
	sourceCatalogProductId: string | null;
	variants: AccountProductVariant[];
	image: ProductAsset | null;
	downloads: ProductAsset[];
	weightGrams: number | null;
	archived: boolean;
	revision: number;
	createdAt: string;
	updatedAt: string;
}
export interface SaveAccountProduct {
	name: string;
	description: string;
	category: string;
	type: AccountProductType;
	variants: AccountProductVariant[];
	imageAssetId: string | null;
	downloadAssetIds: string[];
	weightGrams: number | null;
	revision?: number;
	storeId?: string;
	visibility?: ProductVisibility;
}
export interface StoreProductListing {
	id: string;
	product: AccountProduct;
	visibility: ProductVisibility;
	published: boolean;
	pendingChanges: boolean;
	revenueCents: number;
	orders: number;
	customers: number;
	unitsSold: number;
}
export interface StoreProductCollection {
	appId: string;
	currency: 'usd';
	products: StoreProductListing[];
	hasUnpublishedChanges: boolean;
}
export interface AddStoreProduct {
	productId?: string;
	catalogProductId?: string;
	publishedProductId?: string;
	visibility?: ProductVisibility;
}
export interface UpdateStoreProduct {
	visibility: ProductVisibility;
}
export interface AccountProductList {
	products: AccountProduct[];
}
