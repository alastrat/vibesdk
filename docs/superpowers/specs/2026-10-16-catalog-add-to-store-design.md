# Adding catalog products to a store — design

Status: written on 2026-10-16 under the owner's overnight approval ("yes to all", item 6: a Catalog page in the app,
`search_catalog` / `get_catalog_product` Think tools, and the agent writes `catalogVariantId` plus the seller's retail
price into `estori-store.json`, never catalog prices).

## Context

- The catalog is built (`docs/superpowers/plans/2026-10-16-cj-catalog-data.md`): `catalog_products`, `catalog_variants`
  and per-destination `catalog_variant_offers` in D1, images served from `/api/catalog/images/...`.
- Checkout prices catalog lines from locked offers (`lockCatalogPrices`) and refuses a retail price under
  `minimumRetailPriceCents(catalogPrice)` (`shared/types/catalog.ts`).
- Stores keep products and prices in `estori-store.json`; a catalog variant carries `catalogVariantId` and the seller's
  retail `priceCents` (`docs/superpowers/specs/2026-10-15-shopper-checkout-design.md`, section 7).

## Goals

- A seller sees what the catalog sells, what each item costs them, and the lowest price they may charge.
- The store agent finds catalog products and adds them to a store correctly, without ever writing a catalog price or a
  supplier name.

## Design

### One view of a catalog product

`worker/services/catalog/catalog-view.ts` turns D1 rows into `CatalogProductView` (in `shared/types/catalog.ts`, re-exported
from `src/api-types.ts`):

- product: `productId`, `title`, `description`, `category`, `imageUrls`, `shipsTo` (the destinations with an available
  offer);
- variant: `catalogVariantId`, `name`, `options`, `imageUrl`, `available`, `deliveryDays`, `catalogPriceCents`,
  `minimumRetailPriceCents`, `suggestedRetailPriceCents`.

Only active products and active variants appear. Prices are for the US, the only destination at launch.
`suggestedRetailPriceCents` is twice the catalog price, ending in 99 cents, and never below the minimum.

### The seller's Catalog page

- `GET /api/catalog/products?q=` (signed in) returns the views.
- `/catalog` (signed in) shows a card per product: images, variants, "Your cost", "Lowest price you can charge" and
  "Suggested price", and "Start a store with this product", which opens a new build with a request naming the product.
- The sidebar gains a Catalog entry next to Discover.
- No supplier name or SKU appears anywhere on the page.

### The agent's tools

- `search_catalog({ query?, limit? })` lists products with their variants.
- `get_catalog_product({ productId })` returns one product.
- Both return the view without `catalogPriceCents`: the agent sees only the minimum and suggested retail prices, so it
  can't copy a catalog price into a store. Image URLs are absolute, on Estori's address.
- The `store-checkout` skill gains a "Catalog products" section: search, pick variants, write `catalogVariantId` and a
  `priceCents` at or above `minimumRetailPriceCents` (default: `suggestedRetailPriceCents`), use the catalog's image URL,
  and ship catalog products to the US only.

## Not in this design

- Publishing-time minimum price checks across ship-to countries (live stores).
- A store picker on the Catalog page; existing stores add products by asking their agent.

## Testing

- `catalogProductView`: active-only, price fields, suggested price rule, absolute image URLs.
- The tools: input validation, no `catalogPriceCents` in their output, no supplier names.
- The skill: the catalog section names both tools and the price rule.
- Wiring: the route is signed-in only; the tools are registered; the page route exists.
