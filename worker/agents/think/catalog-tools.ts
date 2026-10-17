/** `search_catalog` and `get_catalog_product`: the store agent's view of Estori's catalog, without catalog prices. */

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import type { CatalogProductView } from '../../../shared/types/catalog';
import { CatalogProductService } from '../../database';
import { getProtocolForHost } from '../../utils/urls';
import { catalogImagePath } from '../../services/catalog/images';
import { agentProductView, catalogProductView } from '../../services/catalog/catalog-view';

export interface CatalogToolDeps {
	search(query: string | null, limit: number): Promise<CatalogProductView[]>;
	get(productId: string): Promise<CatalogProductView | null>;
}

const HOW_TO_ADD = [
	'To sell a catalog product, add it to estori-store.json like any product, and on each variant set catalogVariantId to the',
	"variant's catalogVariantId and priceCents to the seller's retail price: at least minimumRetailPriceCents, by default",
	'suggestedRetailPriceCents. Use the first of the imageUrls as the product image. Catalog products ship to the US only.',
	"Write your own product names, descriptions and variant names in the store's voice: never copy a brand, a model",
	'number or wholesale terms, and never write a catalog price, a supplier name or a SKU anywhere in the store.',
].join(' ');

export function createCatalogTools(deps: CatalogToolDeps): { search_catalog: Tool; get_catalog_product: Tool } {
	return {
		search_catalog: tool({
			description: `Search Estori's product catalog: products the store can sell without holding stock, shipped to the shopper by Estori. ${HOW_TO_ADD}`,
			inputSchema: z.object({
				query: z.string().max(100).optional().describe('Words to look for in titles and categories; leave out to list everything.'),
				limit: z.number().int().min(1).max(20).optional().describe('How many products to return, 10 by default.'),
			}),
			execute: async (input: { query?: string; limit?: number }) => {
				const products = await deps.search(input.query ?? null, input.limit ?? 10);
				return JSON.stringify({ products: products.map(agentProductView) });
			},
		}),
		get_catalog_product: tool({
			description: `Read one catalog product with all its variants. ${HOW_TO_ADD}`,
			inputSchema: z.object({ productId: z.string().min(1).max(64).describe('The productId from search_catalog.') }),
			execute: async (input: { productId: string }) => {
				const product = await deps.get(input.productId);
				if (!product) return JSON.stringify({ error: `No catalog product ${input.productId}. Use search_catalog to find one.` });
				return JSON.stringify({ product: agentProductView(product) });
			},
		}),
	};
}

/** Catalog views with image URLs on Estori's own address, which stores load directly. */
export function catalogToolDepsFromEnv(env: Env): CatalogToolDeps {
	const origin = `${getProtocolForHost(env.CUSTOM_DOMAIN)}://${env.CUSTOM_DOMAIN}`;
	const imageUrl = (key: string) => `${origin}${catalogImagePath(key)}`;
	const views = async (input: { query: string | null; productId: string | null; limit: number }) => {
		const rows = await new CatalogProductService(env).catalogRows(input);
		const now = Date.now();
		return rows.flatMap((row) => catalogProductView(row, imageUrl, now) ?? []);
	};
	return {
		search: (query, limit) => views({ query, productId: null, limit }),
		get: async (productId) => (await views({ query: null, productId, limit: 1 }))[0] ?? null,
	};
}
