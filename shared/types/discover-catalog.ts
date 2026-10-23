/** Public, curated Discover catalog. Source bundles and entitlements are never public DTOs. */
export type DiscoverKind = 'store' | 'component';
export type DiscoverTier = 'free' | 'premium';
export interface DiscoverCategory {
 id: string; slug: string; title: string; description: string; color: string; count: number; coverUrl: string | null;
}
export interface DiscoverEntry {
 id: string; slug: string; title: string; summary: string; description: string;
 categorySlug: string; categoryTitle: string; kind: DiscoverKind; tier: DiscoverTier;
 priceCents: number; currency: 'usd'; version: string; tags: string[]; features: string[];
 palette: string[]; animationKey: string; coverUrl: string; previewUrl: string; featured: boolean;
}
export interface DiscoverCatalogFilters { search?: string; category?: string; kind?: DiscoverKind; tier?: DiscoverTier; limit?: number; offset?: number; }
export interface DiscoverCatalogPage { entries: DiscoverEntry[]; total: number; limit: number; offset: number; }
export interface DiscoverEntryDetail { entry: DiscoverEntry; related: DiscoverEntry[]; }
export interface DiscoverAccess { owned: boolean; canDownload: boolean; checkoutEnabled: boolean; }
export interface DiscoverCheckout { url: string; }
