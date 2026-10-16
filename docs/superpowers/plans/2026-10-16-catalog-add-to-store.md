# Catalog Add-to-Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sellers browse the catalog on a Catalog page, and the store agent adds catalog products to `estori-store.json` with `catalogVariantId` and a retail price at or above the minimum.

**Architecture:** One pure view builder turns catalog rows into `CatalogProductView`. A signed-in API and the `/catalog` page show it with costs; two Think tools return it without catalog prices, with absolute image URLs. The `store-checkout` skill tells the agent how to use them.

**Tech Stack:** React 19, React Router 7, TanStack Query, kumo components, Hono, D1, the AI SDK's `tool`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-16-catalog-add-to-store-design.md`

## Global Constraints

- The agent never sees or writes a catalog price; it writes `catalogVariantId` and `priceCents` (at least `minimumRetailPriceCents`).
- No supplier name or SKU on the page or in tool output.
- Only active products and variants appear. Prices are for the US.
- No `any`; tabs in `shared/`, `worker/services/`, `worker/agents/`, `src/`; four spaces in `worker/database/` and `worker/api/`.
- Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Tests: `npx vitest run <files>` after sockets drain.

## Review Focus

1. A product paused after a seller opened the page: it is gone on the next load, and the agent's tools don't return it (Task 1).
2. A variant whose offer is stale or unavailable: shown as unavailable, never with a price to copy (Task 1).
3. A search term with SQL wildcards (`%`, `_`): treated as text (Task 1).
4. The agent passes an unknown product id: a clear error, not a crash (Task 3).
5. More than 100 variants across the listed products: no D1 statement binds more than 100 parameters (Task 1).

---

### Task 1: Catalog product views

**Files:**
- Modify: `shared/types/catalog.ts`, `src/api-types.ts`, `worker/database/services/CatalogProductService.ts`
- Create: `worker/services/catalog/catalog-view.ts`
- Test: `worker/services/catalog/catalog-view.test.ts`, `worker/database/services/CatalogProductService.test.ts`

**Interfaces:**
- Produces: `CatalogVariantView`, `CatalogProductView`, `CatalogProductsData`, `suggestedRetailPriceCents(catalogPrice: number): number` (shared); `CatalogRows`, `catalogProductView(rows, imageUrl, nowMs): CatalogProductView | null`, `agentProductView(view): AgentCatalogProduct`; `CatalogProductService.catalogRows(input: { query: string | null; productId: string | null; limit: number }): Promise<CatalogRows[]>`.

- [ ] **Step 1: Write the failing tests**

`worker/services/catalog/catalog-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { suggestedRetailPriceCents } from '../../../shared/types/catalog';
import { agentProductView, catalogProductView, type CatalogRows } from './catalog-view';

const NOW = 1_800_000_000_000;
const ROWS: CatalogRows = {
	product: { id: 'cp_1', title: 'Gravity Pet Feeder', description: 'Feeds and waters.', category: 'Pet supplies', images: ['catalog/cp_1/a.jpg'], status: 'active' },
	variants: [
		{ id: 'cv_blue', name: 'Blue', options: { Color: 'Blue' }, imageKey: 'catalog/cp_1/b.jpg', status: 'active' },
		{ id: 'cv_pink', name: 'Pink', options: { Color: 'Pink' }, imageKey: null, status: 'active' },
		{ id: 'cv_old', name: 'Old', options: {}, imageKey: null, status: 'retired' },
	],
	offers: [
		{ variantId: 'cv_blue', destinationCountry: 'US', available: true, catalogPriceCents: 2028, deliveryDaysMin: 3, deliveryDaysMax: 5, updatedAt: new Date(NOW - 60_000) },
		{ variantId: 'cv_pink', destinationCountry: 'US', available: true, catalogPriceCents: 2028, deliveryDaysMin: 3, deliveryDaysMax: 5, updatedAt: new Date(NOW - 73 * 60 * 60 * 1000) },
	],
};

const url = (key: string) => `https://estori.test/api/catalog/images/${key.slice('catalog/'.length)}`;

describe('suggestedRetailPriceCents', () => {
	it('doubles the catalog price, ending in 99 cents, never below the minimum', () => {
		expect(suggestedRetailPriceCents(2028)).toBe(4099);
		expect(suggestedRetailPriceCents(985)).toBe(1999);
	});
});

describe('catalogProductView', () => {
	it('shows active variants with their cost, minimum and suggested price, and hides stale prices', () => {
		const view = catalogProductView(ROWS, url, NOW);
		expect(view).toEqual({
			productId: 'cp_1',
			title: 'Gravity Pet Feeder',
			description: 'Feeds and waters.',
			category: 'Pet supplies',
			imageUrls: ['https://estori.test/api/catalog/images/cp_1/a.jpg'],
			shipsTo: ['US'],
			variants: [
				{
					catalogVariantId: 'cv_blue',
					name: 'Blue',
					options: { Color: 'Blue' },
					imageUrl: 'https://estori.test/api/catalog/images/cp_1/b.jpg',
					available: true,
					deliveryDays: { min: 3, max: 5 },
					catalogPriceCents: 2028,
					minimumRetailPriceCents: 2120,
					suggestedRetailPriceCents: 4099,
				},
				{ catalogVariantId: 'cv_pink', name: 'Pink', options: { Color: 'Pink' }, imageUrl: null, available: false, deliveryDays: null, catalogPriceCents: null, minimumRetailPriceCents: null, suggestedRetailPriceCents: null },
			],
		});
	});

	it('shows nothing for a product that is not active', () => {
		expect(catalogProductView({ ...ROWS, product: { ...ROWS.product, status: 'paused' } }, url, NOW)).toBeNull();
	});

	it('gives the agent no catalog price to copy', () => {
		const view = catalogProductView(ROWS, url, NOW);
		if (!view) throw new Error('expected a view');
		const agent = agentProductView(view);
		expect(JSON.stringify(agent)).not.toContain('catalogPriceCents');
		expect(agent.variants[0]).toMatchObject({ catalogVariantId: 'cv_blue', minimumRetailPriceCents: 2120, suggestedRetailPriceCents: 4099 });
	});
});
```

Append to `worker/database/services/CatalogProductService.test.ts`:

```ts
describe('CatalogProductService.catalogRows', () => {
	it('reads active products, treating wildcards in the search as text, within D1 limits', async () => {
		const { d1, statements } = recordingD1((sql) => (sql.includes('from "catalog_products"') ? [['cp_1', 'Feeder', 'Feeds.', 'Pet supplies', '["catalog/cp_1/a.jpg"]', 'active']] : []));
		const rows = await new CatalogProductService({ DB: d1 } as unknown as Env).catalogRows({ query: '50%_off', productId: null, limit: 50 });

		expect(rows.map((row) => row.product.id)).toEqual(['cp_1']);
		const search = statements.find((statement) => statement.sql.includes('from "catalog_products"'));
		expect(search?.sql.toLowerCase()).toContain("escape '\\'");
		expect(search?.params).toContain('%50\\%\\_off%');
		expect(Math.max(...statements.map((statement) => statement.params.length))).toBeLessThanOrEqual(100);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run worker/services/catalog/catalog-view.test.ts worker/database/services/CatalogProductService.test.ts`
Expected: FAIL ("Cannot find module './catalog-view'"; "catalogRows is not a function").

- [ ] **Step 3: Write the shared types and the view builder**

Append to `shared/types/catalog.ts`:

```ts
export interface CatalogVariantView {
	catalogVariantId: string;
	name: string;
	options: Record<string, string>;
	imageUrl: string | null;
	available: boolean;
	deliveryDays: { min: number | null; max: number | null } | null;
	/** What one unit costs the seller, US delivery included; null when it can't be sold now. */
	catalogPriceCents: number | null;
	minimumRetailPriceCents: number | null;
	suggestedRetailPriceCents: number | null;
}

export interface CatalogProductView {
	productId: string;
	title: string;
	description: string;
	category: string;
	imageUrls: string[];
	/** Destinations where at least one variant can be sold now. */
	shipsTo: string[];
	variants: CatalogVariantView[];
}

export interface CatalogProductsData {
	products: CatalogProductView[];
}

/** Twice the catalog price, ending in 99 cents, and never below the minimum retail price. */
export function suggestedRetailPriceCents(catalogPrice: number): number {
	return Math.max(Math.ceil((catalogPrice * 2) / 100) * 100 - 1, minimumRetailPriceCents(catalogPrice));
}
```

Re-export from `src/api-types.ts`, next to the store-payments re-export:

```ts
export type { CatalogProductsData, CatalogProductView, CatalogVariantView } from '../shared/types/catalog';
```

`worker/services/catalog/catalog-view.ts`:

```ts
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
```

- [ ] **Step 4: Add the rows query**

In `CatalogProductService` (import `like`, `or`, `asc`, `CatalogRows`):

```ts
    /** Active products (one, or a search), with their variants and offers. Lists are capped at 50 products. */
    async catalogRows(input: { query: string | null; productId: string | null; limit: number }): Promise<CatalogRows[]> {
        const limit = Math.min(Math.max(input.limit, 1), 50);
        const term = input.query?.trim() ? `%${input.query.trim().replace(/[\\%_]/g, (character) => `\\${character}`)}%` : null;
        const products = await this.database
            .select({
                id: schema.catalogProducts.id,
                title: schema.catalogProducts.title,
                description: schema.catalogProducts.description,
                category: schema.catalogProducts.category,
                images: schema.catalogProducts.images,
                status: schema.catalogProducts.status,
            })
            .from(schema.catalogProducts)
            .where(
                and(
                    eq(schema.catalogProducts.status, 'active'),
                    input.productId ? eq(schema.catalogProducts.id, input.productId) : undefined,
                    term
                        ? or(
                              sql`${schema.catalogProducts.title} like ${term} escape '\\'`,
                              sql`${schema.catalogProducts.category} like ${term} escape '\\'`,
                          )
                        : undefined,
                ),
            )
            .orderBy(asc(schema.catalogProducts.title))
            .limit(limit)
            .all();
        if (products.length === 0) return [];
        const productIds = products.map((product) => product.id);
        const variants = await this.database
            .select({
                productId: schema.catalogVariants.productId,
                id: schema.catalogVariants.id,
                name: schema.catalogVariants.name,
                options: schema.catalogVariants.options,
                imageKey: schema.catalogVariants.imageKey,
                status: schema.catalogVariants.status,
            })
            .from(schema.catalogVariants)
            .where(inArray(schema.catalogVariants.productId, productIds))
            .all();
        // Joined on the product ids, so the statement binds at most 50 of them whatever the variant count.
        const offers = await this.database
            .select({
                variantId: schema.catalogVariantOffers.variantId,
                destinationCountry: schema.catalogVariantOffers.destinationCountry,
                available: schema.catalogVariantOffers.available,
                catalogPriceCents: schema.catalogVariantOffers.catalogPriceCents,
                deliveryDaysMin: schema.catalogVariantOffers.deliveryDaysMin,
                deliveryDaysMax: schema.catalogVariantOffers.deliveryDaysMax,
                updatedAt: schema.catalogVariantOffers.updatedAt,
            })
            .from(schema.catalogVariantOffers)
            .innerJoin(schema.catalogVariants, eq(schema.catalogVariants.id, schema.catalogVariantOffers.variantId))
            .where(inArray(schema.catalogVariants.productId, productIds))
            .all();
        return products.map(({ images, ...product }) => ({
            product: { ...product, images: imageKeysOf(images) },
            variants: variants
                .filter((variant) => variant.productId === product.id)
                .map(({ productId: _productId, options, ...variant }) => ({ ...variant, options: JSON.parse(options) as Record<string, string> })),
            offers: offers.filter((offer) => variants.some((variant) => variant.productId === product.id && variant.id === offer.variantId)),
        }));
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run worker/services/catalog/catalog-view.test.ts worker/database/services/CatalogProductService.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/types/catalog.ts src/api-types.ts worker/services/catalog/catalog-view.ts worker/services/catalog/catalog-view.test.ts worker/database/services/CatalogProductService.ts worker/database/services/CatalogProductService.test.ts
git commit -m "feat(catalog): catalog product views for sellers and the store agent

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The seller's Catalog page

**Files:**
- Modify: `worker/api/controllers/catalog/controller.ts`, `worker/api/routes/catalogRoutes.ts`, `src/lib/api-client.ts`, `src/lib/query-keys.ts`, `src/routes.tsx`, `src/components/layout/app-sidebar.tsx`
- Create: `src/routes/catalog/index.tsx`, `src/hooks/use-catalog.ts`
- Test: `worker/api/controllers/catalog/catalog-routes-wiring.test.ts`, `src/routes/catalog/catalog-page.test.ts`

**Interfaces:**
- Produces: `GET /api/catalog/products?q=` (signed in) → `CatalogProductsData`; `apiClient.getCatalogProducts(query?: string)`; `useCatalogProducts(query: string)`; `/catalog`.

- [ ] **Step 1: Write the failing tests**

Add to `catalog-routes-wiring.test.ts`:

```ts
	it('shows the catalog to signed-in sellers', () => {
		const routes = source('/worker/api/routes/catalogRoutes.ts').split('\n');
		expect(routes.find((line) => line.includes("'/api/catalog/products'"))).toContain('setAuthLevel(AuthConfig.authenticated)');
	});
```

`src/routes/catalog/catalog-page.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SUPPLIER_NAMES } from '../copy-rules';

const sources = import.meta.glob<string>(['/src/routes/catalog/index.tsx', '/src/routes.tsx', '/src/components/layout/app-sidebar.tsx'], { query: '?raw', import: 'default', eager: true });

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('the Catalog page', () => {
	it('is a signed-in page linked from the sidebar', () => {
		const routes = source('/src/routes.tsx');
		expect(routes).toContain("path: 'catalog'");
		expect(routes.slice(routes.indexOf("path: 'catalog'"), routes.indexOf("path: 'catalog'") + 200)).toContain('<ProtectedRoute>');
		expect(source('/src/components/layout/app-sidebar.tsx')).toContain("navigate('/catalog')");
	});

	it("shows the seller's cost and price floor, never a supplier name or SKU", () => {
		const page = source('/src/routes/catalog/index.tsx');
		for (const label of ['Your cost', 'Lowest price', 'Suggested price', 'Start a store with this']) expect(page).toContain(label);
		for (const name of SUPPLIER_NAMES) expect(page.toLowerCase()).not.toContain(name);
		expect(page.toLowerCase()).not.toContain('sku');
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run worker/api/controllers/catalog src/routes/catalog/catalog-page.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the API**

In `CatalogController` (import `CatalogProductService`, `catalogProductView`, `catalogImagePath`, `CatalogProductsData`):

```ts
    static async listProducts(request: Request, env: Env, _ctx: ExecutionContext, _context: RouteContext): Promise<ControllerResponse<ApiResponse<CatalogProductsData>>> {
        try {
            const query = new URL(request.url).searchParams.get('q');
            const rows = await new CatalogProductService(env).catalogRows({ query, productId: null, limit: 50 });
            const now = Date.now();
            const products = rows.flatMap((row) => catalogProductView(row, catalogImagePath, now) ?? []);
            return CatalogController.createSuccessResponse<CatalogProductsData>({ products });
        } catch (error) {
            return CatalogController.handleError(error, 'list catalog products') as ControllerResponse<ApiResponse<CatalogProductsData>>;
        }
    }
```

Route, before the admin routes:

```ts
    app.get('/api/catalog/products', setAuthLevel(AuthConfig.authenticated), adaptController(CatalogController, CatalogController.listProducts));
```

`src/lib/api-client.ts`, next to `getStoreOrders` (import `CatalogProductsData`):

```ts
	async getCatalogProducts(query?: string): Promise<ApiResponse<CatalogProductsData>> {
		const search = query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
		return this.request<CatalogProductsData>(`/api/catalog/products${search}`);
	}
```

`src/lib/query-keys.ts`, inside `account` after `contactRequests`:

```ts
		catalog: {
			products: (query: string) => [...queryKeys.account.all, 'catalog', query] as const,
		},
```

`src/hooks/use-catalog.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';

export function useCatalogProducts(query: string) {
	return useQuery({
		queryKey: queryKeys.account.catalog.products(query),
		queryFn: () => unwrap(apiClient.getCatalogProducts(query), "Couldn't load the catalog"),
		retry: false,
	});
}
```

- [ ] **Step 4: Add the page, the route and the sidebar entry**

`src/routes/catalog/index.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Empty, LayerCard, Loader } from '@cloudflare/kumo';
import { pageTitle } from '@/brand';
import type { CatalogProductView, CatalogVariantView } from '@/api-types';
import { useCatalogProducts } from '@/hooks/use-catalog';

function money(cents: number | null): string {
	return cents === null ? 'Unavailable' : `$${(cents / 100).toFixed(2)}`;
}

/** A new build that sells this product: the store agent finds it in the catalog by name. */
function startPath(product: CatalogProductView): string {
	const variant = product.variants.find((candidate) => candidate.available);
	const price = variant?.suggestedRetailPriceCents ? ` at ${money(variant.suggestedRetailPriceCents)}` : '';
	const params = new URLSearchParams({
		query: `Build a store that sells the "${product.title}" from the Estori catalog${price}.`,
		projectType: 'app',
		behaviorType: 'think',
	});
	return `/chat/new?${params.toString()}`;
}

function VariantRow({ variant }: { variant: CatalogVariantView }) {
	return (
		<tr className="border-t border-kumo-line">
			<td className="py-2 pr-4">{variant.name}</td>
			<td className="py-2 pr-4">{money(variant.catalogPriceCents)}</td>
			<td className="py-2 pr-4">{money(variant.minimumRetailPriceCents)}</td>
			<td className="py-2">{money(variant.suggestedRetailPriceCents)}</td>
		</tr>
	);
}

function ProductCard({ product }: { product: CatalogProductView }) {
	const navigate = useNavigate();
	const sellable = product.variants.some((variant) => variant.available);
	return (
		<LayerCard>
			<LayerCard.Primary>
				<div className="grid gap-4 sm:grid-cols-[160px_1fr]">
					{product.imageUrls[0] ? (
						<img src={product.imageUrls[0]} alt={product.title} className="aspect-square w-full rounded-lg object-cover" loading="lazy" />
					) : (
						<div className="aspect-square w-full rounded-lg bg-kumo-tint" aria-hidden="true" />
					)}
					<div className="grid gap-3">
						<div>
							<p className="text-sm text-kumo-subtle">{product.category}</p>
							<h2 className="text-lg font-semibold text-kumo-strong">{product.title}</h2>
							<p className="mt-1 line-clamp-3 text-sm text-kumo-subtle">{product.description}</p>
						</div>
						<div className="overflow-x-auto">
							<table className="w-full text-left text-sm">
								<caption className="sr-only">Variants of {product.title}, with your cost and prices for US delivery</caption>
								<thead className="text-kumo-subtle">
									<tr>
										<th scope="col" className="py-1 pr-4 font-normal">Variant</th>
										<th scope="col" className="py-1 pr-4 font-normal">Your cost</th>
										<th scope="col" className="py-1 pr-4 font-normal">Lowest price</th>
										<th scope="col" className="py-1 font-normal">Suggested price</th>
									</tr>
								</thead>
								<tbody>
									{product.variants.map((variant) => (
										<VariantRow key={variant.catalogVariantId} variant={variant} />
									))}
								</tbody>
							</table>
						</div>
						<div className="flex flex-wrap items-center gap-3">
							<Button variant="primary" disabled={!sellable} onClick={() => navigate(startPath(product))}>
								Start a store with this
							</Button>
							<p className="text-xs text-kumo-subtle">Ships to the US. Your cost includes delivery.</p>
						</div>
					</div>
				</div>
			</LayerCard.Primary>
		</LayerCard>
	);
}

export default function CatalogPage() {
	const [query, setQuery] = useState('');
	const products = useCatalogProducts(query);
	return (
		<div className="size-full">
			<title>{pageTitle('Catalog')}</title>
			<div className="container mx-auto grid max-w-5xl gap-6 px-4 py-8">
				<div className="grid gap-1">
					<h1 className="text-3xl font-semibold text-kumo-strong">Catalog</h1>
					<p className="text-kumo-subtle">
						Products you can sell without holding stock. We ship each order straight to your shopper in plain packaging, and
						take your cost from the sale.
					</p>
				</div>
				<input
					type="search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Search the catalog"
					aria-label="Search the catalog"
					className="w-full rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-sm"
				/>
				{products.data ? (
					products.data.products.length === 0 ? (
						<Empty title="Nothing matches" description="Try another word." />
					) : (
						<div className="grid gap-4">
							{products.data.products.map((product) => (
								<ProductCard key={product.productId} product={product} />
							))}
						</div>
					)
				) : products.isLoading ? (
					<div className="flex justify-center py-16">
						<Loader />
					</div>
				) : (
					<Empty title="Couldn't load the catalog" description={products.error?.message} />
				)}
			</div>
		</div>
	);
}
```

In `src/routes.tsx`, import `CatalogPage from './routes/catalog'` and add after the `apps` route:

```tsx
					{
						path: 'catalog',
						element: (
							<ProtectedRoute>
								<CatalogPage />
							</ProtectedRoute>
						),
					},
```

In `src/components/layout/app-sidebar.tsx`, import `PackageIcon` with the other icons, and add a Catalog entry after each Discover entry: in the collapsed rail a `Button` like Discover's (`id="catalog-link"`, `aria-label="Catalog"`, `onClick={() => navigate('/catalog')}`, `icon={<PackageIcon className="size-4" />}`), and in the expanded menu a `Sidebar.MenuButton` like Discover's (`active={pathname === '/catalog'}`, icon `PackageIcon` duotone, label "Catalog"). Show both only when a user is signed in (`user &&`).

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run worker/api/controllers/catalog src/routes/catalog/catalog-page.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit -p tsconfig.app.json` and `npx tsc --noEmit -p tsconfig.worker.json`
Expected: no errors outside `packages/artifacts-viewer`.

- [ ] **Step 6: Commit**

```bash
git add worker/api/controllers/catalog worker/api/routes/catalogRoutes.ts src/lib/api-client.ts src/lib/query-keys.ts src/hooks/use-catalog.ts src/routes/catalog src/routes.tsx src/components/layout/app-sidebar.tsx
git commit -m "feat(catalog): a catalog page with each product's cost and price floor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The store agent's catalog tools

**Files:**
- Create: `worker/agents/think/catalog-tools.ts`
- Modify: `worker/agents/think/ThinkAgent.ts` (`getTools`), `worker/agents/think/skills/store-checkout/SKILL.md`
- Test: `worker/agents/think/catalog-tools.test.ts`, `worker/agents/think/store-checkout-skill.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `CatalogToolDeps = { search(query: string | null, limit: number): Promise<CatalogProductView[]>; get(productId: string): Promise<CatalogProductView | null> }`; `createCatalogTools(deps): { search_catalog: Tool; get_catalog_product: Tool }`; `catalogToolDepsFromEnv(env: Env): CatalogToolDeps`.

- [ ] **Step 1: Write the failing tests**

`worker/agents/think/catalog-tools.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CatalogProductView } from '../../../shared/types/catalog';
import { createCatalogTools } from './catalog-tools';

const PRODUCT: CatalogProductView = {
	productId: 'cp_1',
	title: 'Gravity Pet Feeder',
	description: 'Feeds and waters.',
	category: 'Pet supplies',
	imageUrls: ['https://estori.test/api/catalog/images/cp_1/a.jpg'],
	shipsTo: ['US'],
	variants: [
		{ catalogVariantId: 'cv_blue', name: 'Blue', options: { Color: 'Blue' }, imageUrl: null, available: true, deliveryDays: { min: 3, max: 5 }, catalogPriceCents: 2028, minimumRetailPriceCents: 2120, suggestedRetailPriceCents: 4099 },
	],
};

const tools = createCatalogTools({
	search: async () => [PRODUCT],
	get: async (productId) => (productId === 'cp_1' ? PRODUCT : null),
});

type Executable = { execute?: (input: unknown, options: unknown) => unknown };

async function run(tool: unknown, input: unknown): Promise<string> {
	const execute = (tool as Executable).execute;
	if (!execute) throw new Error('tool has no execute');
	return String(await execute(input, { toolCallId: 't1', messages: [] }));
}

describe('the catalog tools', () => {
	it('return products with retail price guidance and no catalog price', async () => {
		for (const output of [await run(tools.search_catalog, { query: 'pet' }), await run(tools.get_catalog_product, { productId: 'cp_1' })]) {
			expect(output).toContain('cv_blue');
			expect(output).toContain('"minimumRetailPriceCents":2120');
			expect(output).not.toContain('catalogPriceCents');
		}
	});

	it('answer an unknown product with an error the model can act on', async () => {
		expect(JSON.parse(await run(tools.get_catalog_product, { productId: 'cp_x' }))).toEqual({ error: 'No catalog product cp_x. Use search_catalog to find one.' });
	});

	it('tell the model how to add a product to a store', () => {
		const description = `${tools.search_catalog.description} ${tools.get_catalog_product.description}`;
		for (const phrase of ['estori-store.json', 'catalogVariantId', 'minimumRetailPriceCents']) expect(description).toContain(phrase);
	});
});
```

Add to `store-checkout-skill.test.ts`:

```ts
	it('teaches catalog products through the catalog tools', () => {
		for (const phrase of ['search_catalog', 'get_catalog_product', 'minimumRetailPriceCents', 'suggestedRetailPriceCents']) expect(SKILL).toContain(phrase);
	});
```

and to the wiring, a source check in `catalog-tools.test.ts`:

```ts
const agentSources = import.meta.glob<string>('/worker/agents/think/ThinkAgent.ts', { query: '?raw', import: 'default', eager: true });

describe('the agent', () => {
	it('registers the catalog tools', () => {
		const agent = Object.values(agentSources)[0] ?? '';
		expect(agent).toContain('...createCatalogTools(catalogToolDepsFromEnv(this.env))');
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run worker/agents/think/catalog-tools.test.ts worker/agents/think/store-checkout-skill.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the tools, register them, and extend the skill**

`worker/agents/think/catalog-tools.ts`:

```ts
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
	'suggestedRetailPriceCents. Use the imageUrls as the product image. Catalog products ship to the US only. Never write a',
	"catalog price, a supplier name or a SKU anywhere in the store.",
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
```

In `ThinkAgent.getTools()`, import both functions and add before `set_title`:

```ts
			// Estori's catalog, for stores that sell catalog products.
			...createCatalogTools(catalogToolDepsFromEnv(this.env)),
```

Append to `worker/agents/think/skills/store-checkout/SKILL.md`:

```markdown
## 6. Catalog products

Estori's catalog has products a store can sell without holding stock: Estori ships each order to the shopper.

1. Call `search_catalog` (or `get_catalog_product` with a `productId`) to find products. Each variant has a
   `catalogVariantId`, a `minimumRetailPriceCents` and a `suggestedRetailPriceCents`.
2. Add the product to `estori-store.json`. On each variant, set `catalogVariantId`, and set `priceCents` to the seller's
   price: at least `minimumRetailPriceCents`, by default `suggestedRetailPriceCents`.
3. Use the catalog's `imageUrls` as the product `image`.
4. Catalog products ship to the US only: keep `"US"` in `shipping.countries`.
5. Never write a catalog price, a supplier name or a SKU anywhere in the store.
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run worker/agents/think`
Expected: PASS.
Run: `npx tsc --noEmit -p tsconfig.worker.json`
Expected: no errors outside `packages/artifacts-viewer`.

- [ ] **Step 5: Commit**

```bash
git add worker/agents/think/catalog-tools.ts worker/agents/think/catalog-tools.test.ts worker/agents/think/ThinkAgent.ts worker/agents/think/skills/store-checkout/SKILL.md worker/agents/think/store-checkout-skill.test.ts
git commit -m "feat(agent): catalog tools for adding catalog products to a store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
