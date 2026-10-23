import type { DiscoverKind, DiscoverTier } from './discover-catalog';
export interface CatalogArtifactFile { path: string; content: string; }
export interface CatalogArtifact {
 slug: string; title: string; summary: string; description: string;
 categorySlug: string; kind: DiscoverKind; tier: DiscoverTier; priceCents: number;
 tags: string[]; features: string[]; palette: string[]; animationKey: string; featured: boolean;
 /** Standalone public preview. No external dependencies/network/scripts. */
 previewHtml: string;
 /** Original SVG artwork, not a screenshot of a third-party website. */
 coverSvg: string;
 /** Runnable original source with README. Paths relative, no secrets. */
 files: CatalogArtifactFile[];
}
