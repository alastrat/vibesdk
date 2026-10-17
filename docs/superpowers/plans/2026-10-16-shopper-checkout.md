# Shopper Checkout (Preview, Test Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shopper on a generated store's preview pays for own and catalog products through Stripe test-mode Checkout, and Estori records one store order (and, for catalog lines, one catalog order) from Estori's own prices.

**Architecture:** Stores load `/__estori/store.js` and send only variant ids, quantities, a ship-to country and return paths. The worker answers every `/__estori/*` path of a preview before SpaceDO sees it, prices the cart from the deployed commit's `estori-store.json` (recorded by SpaceDO at deploy time) and locked catalog prices, creates a destination-charge Checkout session with `on_behalf_of`, and records the order from the webhook or the return page through one function. Pure modules live in `worker/services/store-payments/`; D1 holds checkouts, orders and items.

**Tech Stack:** Cloudflare Workers, D1 with Drizzle, Durable Objects (SpaceDO), Stripe REST over `fetch`, Vitest with `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-10-15-shopper-checkout-design.md` (owner accepted all 13 recommendations on 2026-10-15). Related: `docs/superpowers/specs/2026-10-15-catalog-order-payments-design.md` (implemented on this branch) and `docs/superpowers/specs/2026-10-15-cjdropshipping-adapter-design.md`.

**Scope of this plan (phase 1):** previews only, owner-only, Stripe test mode. The spec's live stores, own-product refunds and disputes, Express Dashboard refund recording, the store's own order copy (Facet outbox), order emails, rate limits and the seller's Payments card are listed under "Not in this plan" with the reason each waits.

## Global Constraints

- No `any`. Tabs in `shared/`, `worker/services/`, `worker/api/handlers/`; four spaces in `worker/database/`, `worker/api/controllers/`, `worker/api/routes/`; two spaces and no semicolons in `space/`.
- Amounts are integer US cents; currency `usd` only.
- A checkout request names only `items` (`variantId`, `quantity`), `shipTo`, `successPath`, `cancelPath`, `note`; anything else is refused with `invalid_request`.
- Estori derives amounts from the manifest and catalog locks, the fee from `applicationFeeCents(cart)`, the destination from the app's owner, and the store from the preview address.
- Previews take Stripe test-mode payments only, and only for the app's owner; public previews get `demo_only`.
- Shopper-facing text never names a supplier or an AI assistant (`SUPPLIER_NAMES`, `src/routes/copy-rules.ts`).
- Commits: `type(scope): lowercase subject`, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `.dev.vars`, `bun.lockb`, `.superpowers/`, or local `wrangler.jsonc` overrides.
- Tests: `rtk proxy npx vitest run <files>`, a few files at a time, from the repo root.

## Review Focus

1. A store page posts `amount`, `price`, `fee` or `account` in the checkout body: answered `invalid_request`, and nothing is priced from it (Task 2 tests the parser; Task 10 tests the orchestration refuses before any lookup).
2. `/__estori` reaches the preview in another case or percent-encoded (`/__ESTORI/`, `%5F%5Festori`, `%255F%255Festori`): the platform answers it and it is never forwarded to the store (Task 11).
3. The webhook and the return page record the same paid session at the same time: one store order, one catalog order (Task 5's unique checkout id, Task 7's idempotent hand-off).
4. A catalog line whose lock fails, or whose retail price is under the catalog minimum: refused before any Stripe call (Tasks 3 and 10).
5. Stripe redirects back after the 30-minute preview token expired: the shopper sees the access page, and the webhook still records the order (Task 11 keeps recording in the webhook; the return page is a convenience).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `shared/types/store-payments.ts` | Manifest, request, response, priced cart, receipt and store-info types; limits; refusal messages |
| `worker/services/store-payments/manifest.ts` | `parseStoreManifest(text)` |
| `worker/services/store-payments/request.ts` | `parseCheckoutRequest(body)`, `safeReturnPath(value, fallback)` |
| `worker/services/store-payments/pricing.ts` | `CatalogLock`, `priceCart`, `toCheckoutCart`, `requestedCatalogVariantIds` |
| `worker/services/store-payments/store.ts` | Record types shared by the services and the orchestration |
| `worker/services/store-payments/fulfill.ts` | `recordStoreOrder(deps, session)`, `shippingAddressOf(session)` |
| `worker/services/store-payments/receipts.ts` | Receipt cookie claims, cookie header, signing, `receiptOf(order)` |
| `worker/services/store-payments/store-script.ts` | The `/__estori/store.js` source |
| `worker/services/store-payments/checkout.ts` | `startStoreCheckout(deps, input)`, `storeInfoOf(manifest, available)` |
| `worker/services/store-payments/catalog-locks.ts` | Catalog price locks for checkout (refuses until the catalog connection lands) |
| `worker/services/store-payments/wiring.ts` | D1 and Stripe wiring shared by the webhook and the return page |
| `worker/database/schema.ts`, `migrations/0018_*.sql` | `store_checkouts`, `store_orders`, `store_order_items` |
| `worker/database/services/StoreCheckoutService.ts`, `StoreOrderService.ts` | D1 reads and writes |
| `worker/services/payments/stripe-client.ts` | `createStoreCheckoutSession`, typed shopper details on sessions |
| `space/src/space/store-manifest.ts`, `deploy-engine.ts`, `durable-object.ts` | Record the deployed `estori-store.json`; `getStoreManifest(branch)` |
| `worker/api/handlers/store-platform.ts`, `space-preview.ts` | `/__estori/*` on previews |
| `worker/api/controllers/payments/webhook.ts` | Store sessions to `recordStoreOrder`; expiry |
| `worker/api/routes/storeRoutes.ts`, `worker/api/controllers/stores/controller.ts` | `GET /api/stores/:id/orders` |
| `worker/agents/think/skills/store-checkout/SKILL.md`, `skills.ts`, `app-file-structure/SKILL.md` | The agent's contract |

---

### Task 1: Store payment types and the manifest parser

**Files:**
- Create: `shared/types/store-payments.ts`
- Create: `worker/services/store-payments/manifest.ts`
- Test: `worker/services/store-payments/manifest.test.ts`

**Interfaces:**
- Consumes: `CatalogSupplier` from `shared/types/catalog.ts`.
- Produces: every type and constant in `shared/types/store-payments.ts`; `parseStoreManifest(text: string): ManifestResult` with `ManifestResult = { ok: true; manifest: StoreManifest } | { ok: false; errors: string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { parseStoreManifest } from './manifest';

const VALID = {
	version: 1,
	currency: 'usd',
	shipping: { countries: ['US', 'CA'], flatRateCents: 600, freeOverCents: 7500 },
	products: [
		{
			id: 'trail-mug',
			name: 'Trail Mug',
			description: 'Enamel camping mug.',
			image: '/images/trail-mug.jpg',
			variants: [
				{ id: 'trail-mug-blue', name: 'Blue', priceCents: 2400 },
				{ id: 'trail-mug-red', name: 'Red', priceCents: 2400, available: false },
			],
		},
	],
};

function parse(value: unknown) {
	return parseStoreManifest(JSON.stringify(value));
}

function errorsOf(value: unknown): string[] {
	const result = parse(value);
	return result.ok ? [] : result.errors;
}

describe('parseStoreManifest', () => {
	it('reads a valid file', () => {
		expect(parse(VALID)).toEqual({ ok: true, manifest: VALID });
	});

	it('rejects unknown fields, naming their path', () => {
		expect(errorsOf({ ...VALID, amount: 5 })).toContain('amount: unknown field');
		const product = { ...VALID.products[0], variants: [{ ...VALID.products[0].variants[0], fee: 1 }] };
		expect(errorsOf({ ...VALID, products: [product] })).toContain('products[0].variants[0].fee: unknown field');
	});

	it('rejects malformed and duplicate ids', () => {
		expect(errorsOf({ ...VALID, products: [{ ...VALID.products[0], id: 'Trail Mug' }] })).toContain(
			'products[0].id: lowercase letters, digits and dashes, starting with a letter or digit',
		);
		const copy = { ...VALID.products[0], id: 'trail-mug-2' };
		expect(errorsOf({ ...VALID, products: [VALID.products[0], copy] })).toContain('products[1].variants[0].id: duplicate variant id "trail-mug-blue"');
	});

	it('keeps prices between 50 cents and $10,000, in whole cents', () => {
		for (const priceCents of [49, 1_000_001, 24.5]) {
			const product = { ...VALID.products[0], variants: [{ id: 'v', name: 'V', priceCents }] };
			expect(errorsOf({ ...VALID, products: [product] })).toContain('products[0].variants[0].priceCents: whole cents from 50 to 1000000');
		}
	});

	it('limits the file to 200 products', () => {
		const products = Array.from({ length: 201 }, (_, index) => ({ id: `p-${index}`, name: 'P', variants: [{ id: `v-${index}`, name: 'V', priceCents: 500 }] }));
		expect(errorsOf({ ...VALID, products })).toContain('products: at most 200 products');
	});

	it('refuses ship-to codes that are not two capital letters', () => {
		expect(errorsOf({ ...VALID, shipping: { ...VALID.shipping, countries: ['us'] } })).toContain('shipping.countries[0]: a two-letter country code such as US');
	});

	it('accepts catalog variants and images served by Estori', () => {
		const lamp = {
			id: 'desk-lamp',
			name: 'Desk Lamp',
			image: 'https://estori.app/api/catalog/images/p1/a1b2.jpg',
			variants: [{ id: 'desk-lamp-black', name: 'Black', priceCents: 3500, catalogVariantId: '5e0c1d64-8f1e-4a7b-9b55-2f7f6c1d9a10' }],
		};
		expect(parse({ ...VALID, products: [lamp] }).ok).toBe(true);
		expect(errorsOf({ ...VALID, products: [{ ...lamp, image: '//cdn.example/x.jpg' }] })).toContain('products[0].image: a path on the store such as /images/mug.jpg, or an https address');
	});

	it('refuses text that is not JSON', () => {
		expect(parseStoreManifest('{')).toEqual({ ok: false, errors: ['estori-store.json: not valid JSON'] });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run worker/services/store-payments/manifest.test.ts`
Expected: FAIL, "Cannot find module './manifest'".

- [ ] **Step 3: Write the shared types**

`shared/types/store-payments.ts`:

```ts
/** Store payments: a store's price list (`estori-store.json`), the checkout request and answer, and the priced cart. Amounts are US cents. */

import type { CatalogSupplier } from './catalog';

export const STORE_MANIFEST_FILE = 'estori-store.json';
/** Every path under it on a store's address belongs to the platform. */
export const STORE_PLATFORM_PREFIX = '/__estori';
/** `metadata.kind` of every store Checkout session. */
export const STORE_ORDER_KIND = 'store_order';

export const STORE_CART_MIN_CENTS = 50;
/** A fraud cap on one order. */
export const STORE_CART_MAX_CENTS = 1_000_000;
export const STORE_CART_MAX_LINES = 50;
export const STORE_LINE_MAX_QUANTITY = 99;
export const STORE_PRICE_MIN_CENTS = 50;
export const STORE_PRICE_MAX_CENTS = 1_000_000;

export const STORE_MODES = ['test', 'live'] as const;
export type StoreMode = (typeof STORE_MODES)[number];
export const STORE_CHECKOUT_STATUSES = ['creating', 'open', 'completed', 'expired', 'failed'] as const;
export type StoreCheckoutStatus = (typeof STORE_CHECKOUT_STATUSES)[number];
export const STORE_PAYMENT_STATUSES = ['paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost'] as const;
export type StorePaymentStatus = (typeof STORE_PAYMENT_STATUSES)[number];
export const STORE_FULFILLMENT_STATUSES = ['unfulfilled', 'fulfilled'] as const;
export type StoreFulfillmentStatus = (typeof STORE_FULFILLMENT_STATUSES)[number];
export const STORE_LINE_KINDS = ['own', 'catalog'] as const;
export type StoreLineKind = (typeof STORE_LINE_KINDS)[number];

export interface StoreManifestVariant {
	id: string;
	name: string;
	/** The seller's retail price for one unit. */
	priceCents: number;
	available?: boolean;
	/** Set on catalog products: the catalog variant this sells. The catalog price never appears in the file. */
	catalogVariantId?: string;
}

export interface StoreManifestProduct {
	id: string;
	name: string;
	description?: string;
	image?: string;
	variants: StoreManifestVariant[];
}

export interface StoreShipping {
	/** ISO 3166-1 alpha-2 codes. */
	countries: string[];
	/** Per order; 0 is free shipping. */
	flatRateCents: number;
	/** Shipping is free for subtotals at or above it. */
	freeOverCents?: number;
}

export interface StoreManifest {
	version: 1;
	currency: 'usd';
	shipping: StoreShipping;
	products: StoreManifestProduct[];
}

export interface StoreCheckoutRequest {
	items: { variantId: string; quantity: number }[];
	shipTo: string;
	successPath?: string;
	cancelPath?: string;
	note?: string;
}

export type StoreCheckoutRefusal =
	| 'payments_unavailable'
	| 'demo_only'
	| 'invalid_request'
	| 'unknown_item'
	| 'item_unavailable'
	| 'ships_to_unsupported'
	| 'below_minimum_price'
	| 'cart_limits'
	| 'stripe_failed';

export type StoreCheckoutResponse = { ok: true; checkoutUrl: string } | { ok: false; reason: StoreCheckoutRefusal; message: string };

/** What the shopper reads for each refusal; never the internal reason. */
export const STORE_CHECKOUT_MESSAGES: Readonly<Record<StoreCheckoutRefusal, string>> = {
	payments_unavailable: "This store can't take payments right now.",
	demo_only: 'This is a demo. Checkout works on the live store.',
	invalid_request: "Your cart couldn't be read. Refresh the page and try again.",
	unknown_item: 'An item in your cart is no longer sold here.',
	item_unavailable: 'An item in your cart is sold out.',
	ships_to_unsupported: "This store doesn't ship to that country.",
	below_minimum_price: "An item in your cart can't be sold at its current price.",
	cart_limits: "Your cart is more than one order can hold.",
	stripe_failed: "Checkout couldn't start. Try again in a moment.",
};

interface PricedLineBase {
	productId: string;
	variantId: string;
	/** "Product, Variant", as the shopper sees it in Checkout. */
	name: string;
	quantity: number;
	unitPriceCents: number;
}

/** The cart shape the catalog fee reads, through `toCheckoutCart`. */
export type PricedLine =
	| (PricedLineBase & { kind: 'own' })
	| (PricedLineBase & {
			kind: 'catalog';
			catalogVariantId: string;
			supplier: CatalogSupplier;
			supplierVariantId: string;
			destinationCountry: string;
			lockedCatalogPriceCents: number;
	  });

export interface PricedCart {
	mode: StoreMode;
	storeAppId: string;
	/** The live store version; null for test checkouts, which price from the preview commit. */
	storeVersionId: string | null;
	commitHash: string;
	/** The seller's connected account. */
	sellerStripeAccountId: string | null;
	currency: 'usd';
	shipToCountry: string;
	lines: PricedLine[];
	subtotalCents: number;
	shippingCents: number;
	totalCents: number;
}

/** `Estori.store()`: what a store page renders and whether it may offer checkout. */
export interface StoreInfo {
	mode: StoreMode;
	paymentsAvailable: boolean;
	currency: 'usd';
	shipping: StoreShipping;
	products: StoreManifestProduct[];
}

/** `Estori.order(id)`: the shopper's receipt. Never the street address or phone. */
export interface StoreReceipt {
	orderId: string;
	orderNumber: number;
	createdAt: string;
	mode: StoreMode;
	paymentStatus: StorePaymentStatus;
	items: { name: string; quantity: number; unitPriceCents: number }[];
	subtotalCents: number;
	shippingCents: number;
	totalCents: number;
	shipCity: string | null;
	shipCountry: string | null;
	customerEmail: string | null;
}
```

- [ ] **Step 4: Write the parser**

`worker/services/store-payments/manifest.ts`:

```ts
/** Reads and validates a store's `estori-store.json`. Every error names its JSON path. Pure. */

import {
	STORE_MANIFEST_FILE,
	STORE_PRICE_MAX_CENTS,
	STORE_PRICE_MIN_CENTS,
	type StoreManifest,
	type StoreManifestProduct,
	type StoreManifestVariant,
	type StoreShipping,
} from '../../../shared/types/store-payments';

export type ManifestResult = { ok: true; manifest: StoreManifest } | { ok: false; errors: string[] };

const MAX_BYTES = 256 * 1024;
const MAX_PRODUCTS = 200;
const MAX_VARIANTS = 1000;
const MAX_COUNTRIES = 50;
const MAX_NAME = 200;
const MAX_DESCRIPTION = 5000;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CATALOG_VARIANT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const COUNTRY = /^[A-Z]{2}$/;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isText(value: unknown, max: number): value is string {
	return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

/** A path on the store, or an absolute address: catalog images are served by Estori, not by the store. */
function isImage(value: unknown): value is string {
	if (typeof value !== 'string' || value.length > 2048) return false;
	if (value.startsWith('/')) return !value.startsWith('//');
	return /^https?:\/\/\S+$/.test(value);
}

class Checker {
	readonly errors: string[] = [];

	fail(path: string, message: string): void {
		this.errors.push(`${path}: ${message}`);
	}

	onlyKeys(value: JsonObject, allowed: readonly string[], path: string): void {
		for (const key of Object.keys(value)) {
			if (!allowed.includes(key)) this.fail(path ? `${path}.${key}` : key, 'unknown field');
		}
	}
}

function readShipping(check: Checker, value: unknown): StoreShipping | null {
	if (!isObject(value)) {
		check.fail('shipping', 'an object with countries and flatRateCents');
		return null;
	}
	check.onlyKeys(value, ['countries', 'flatRateCents', 'freeOverCents'], 'shipping');
	const { countries, flatRateCents, freeOverCents } = value;
	if (!Array.isArray(countries) || countries.length === 0 || countries.length > MAX_COUNTRIES) {
		check.fail('shipping.countries', `1 to ${MAX_COUNTRIES} country codes`);
	} else {
		countries.forEach((country, index) => {
			if (typeof country !== 'string' || !COUNTRY.test(country)) check.fail(`shipping.countries[${index}]`, 'a two-letter country code such as US');
		});
	}
	if (!isCount(flatRateCents)) check.fail('shipping.flatRateCents', 'whole cents, 0 or more');
	if (freeOverCents !== undefined && !isCount(freeOverCents)) check.fail('shipping.freeOverCents', 'whole cents, 0 or more');
	if (!Array.isArray(countries) || !isCount(flatRateCents)) return null;
	return {
		countries: countries.filter((country): country is string => typeof country === 'string'),
		flatRateCents,
		...(isCount(freeOverCents) && { freeOverCents }),
	};
}

function readVariant(check: Checker, value: unknown, path: string, seen: Set<string>): StoreManifestVariant | null {
	if (!isObject(value)) {
		check.fail(path, 'an object with id, name and priceCents');
		return null;
	}
	check.onlyKeys(value, ['id', 'name', 'priceCents', 'available', 'catalogVariantId'], path);
	const { id, name, priceCents, available, catalogVariantId } = value;
	if (typeof id !== 'string' || !ID.test(id)) check.fail(`${path}.id`, 'lowercase letters, digits and dashes, starting with a letter or digit');
	else if (seen.has(id)) check.fail(`${path}.id`, `duplicate variant id "${id}"`);
	if (!isText(name, MAX_NAME)) check.fail(`${path}.name`, `text of 1 to ${MAX_NAME} characters`);
	const pricedRight = typeof priceCents === 'number' && Number.isInteger(priceCents) && priceCents >= STORE_PRICE_MIN_CENTS && priceCents <= STORE_PRICE_MAX_CENTS;
	if (!pricedRight) check.fail(`${path}.priceCents`, `whole cents from ${STORE_PRICE_MIN_CENTS} to ${STORE_PRICE_MAX_CENTS}`);
	if (available !== undefined && typeof available !== 'boolean') check.fail(`${path}.available`, 'true or false');
	if (catalogVariantId !== undefined && (typeof catalogVariantId !== 'string' || !CATALOG_VARIANT_ID.test(catalogVariantId))) {
		check.fail(`${path}.catalogVariantId`, 'a catalog variant id');
	}
	if (typeof id !== 'string' || !isText(name, MAX_NAME) || !pricedRight) return null;
	seen.add(id);
	return {
		id,
		name,
		priceCents: priceCents as number,
		...(typeof available === 'boolean' && { available }),
		...(typeof catalogVariantId === 'string' && { catalogVariantId }),
	};
}

function readProduct(check: Checker, value: unknown, path: string, seen: Set<string>): StoreManifestProduct | null {
	if (!isObject(value)) {
		check.fail(path, 'an object with id, name and variants');
		return null;
	}
	check.onlyKeys(value, ['id', 'name', 'description', 'image', 'variants'], path);
	const { id, name, description, image, variants } = value;
	if (typeof id !== 'string' || !ID.test(id)) check.fail(`${path}.id`, 'lowercase letters, digits and dashes, starting with a letter or digit');
	if (!isText(name, MAX_NAME)) check.fail(`${path}.name`, `text of 1 to ${MAX_NAME} characters`);
	if (description !== undefined && !isText(description, MAX_DESCRIPTION)) check.fail(`${path}.description`, `text of 1 to ${MAX_DESCRIPTION} characters`);
	if (image !== undefined && !isImage(image)) check.fail(`${path}.image`, 'a path on the store such as /images/mug.jpg, or an https address');
	if (!Array.isArray(variants) || variants.length === 0) {
		check.fail(`${path}.variants`, 'at least one variant');
		return null;
	}
	const read = variants.map((variant, index) => readVariant(check, variant, `${path}.variants[${index}]`, seen));
	if (typeof id !== 'string' || !isText(name, MAX_NAME)) return null;
	return {
		id,
		name,
		...(typeof description === 'string' && { description }),
		...(typeof image === 'string' && { image }),
		variants: read.filter((variant): variant is StoreManifestVariant => variant !== null),
	};
}

export function parseStoreManifest(text: string): ManifestResult {
	if (new TextEncoder().encode(text).byteLength > MAX_BYTES) return { ok: false, errors: [`${STORE_MANIFEST_FILE}: at most 256 KB`] };
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return { ok: false, errors: [`${STORE_MANIFEST_FILE}: not valid JSON`] };
	}
	const check = new Checker();
	if (!isObject(value)) return { ok: false, errors: [`${STORE_MANIFEST_FILE}: an object with version, currency, shipping and products`] };
	check.onlyKeys(value, ['version', 'currency', 'shipping', 'products'], '');
	if (value.version !== 1) check.fail('version', 'must be 1');
	if (value.currency !== 'usd') check.fail('currency', 'must be "usd"');
	const shipping = readShipping(check, value.shipping);
	const { products } = value;
	const read: StoreManifestProduct[] = [];
	if (!Array.isArray(products) || products.length === 0) {
		check.fail('products', 'at least one product');
	} else if (products.length > MAX_PRODUCTS) {
		check.fail('products', `at most ${MAX_PRODUCTS} products`);
	} else {
		const seen = new Set<string>();
		products.forEach((product, index) => {
			const parsed = readProduct(check, product, `products[${index}]`, seen);
			if (parsed) read.push(parsed);
		});
		if (seen.size > MAX_VARIANTS) check.fail('products', `at most ${MAX_VARIANTS} variants in all`);
	}
	if (check.errors.length > 0 || !shipping) return { ok: false, errors: check.errors };
	return { ok: true, manifest: { version: 1, currency: 'usd', shipping, products: read } };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `rtk proxy npx vitest run worker/services/store-payments/manifest.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add shared/types/store-payments.ts worker/services/store-payments/manifest.ts worker/services/store-payments/manifest.test.ts
git commit -m "feat(store-payments): store manifest types and validation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The checkout request and safe return paths

**Files:**
- Create: `worker/services/store-payments/request.ts`
- Test: `worker/services/store-payments/request.test.ts`

**Interfaces:**
- Consumes: `StoreCheckoutRequest`, `STORE_CART_MAX_LINES` (Task 1).
- Produces: `parseCheckoutRequest(body: unknown): StoreCheckoutRequest | null`; `safeReturnPath(value: unknown, fallback: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { parseCheckoutRequest, safeReturnPath } from './request';

describe('safeReturnPath', () => {
	it('keeps a path on the store', () => {
		expect(safeReturnPath('/thanks', '/')).toBe('/thanks');
		expect(safeReturnPath('/orders/done?x=1', '/')).toBe('/orders/done?x=1');
	});

	it('falls back for anything that could leave the store', () => {
		for (const value of ['//evil.example', 'https://evil.example', 'javascript:alert(1)', '/a\\b', '/a\nb', `/${'a'.repeat(200)}`, 42, undefined]) {
			expect(safeReturnPath(value, '/')).toBe('/');
		}
	});
});

describe('parseCheckoutRequest', () => {
	const VALID = { items: [{ variantId: 'trail-mug-blue', quantity: 2 }], shipTo: 'us', successPath: '/thanks', cancelPath: '/cart', note: 'Gift' };

	it('reads variant ids, quantities, the country, return paths and a note', () => {
		expect(parseCheckoutRequest(VALID)).toEqual({ ...VALID, shipTo: 'US' });
		expect(parseCheckoutRequest({ items: VALID.items, shipTo: 'CA' })).toEqual({ items: VALID.items, shipTo: 'CA' });
	});

	it('refuses amounts, prices, fees and accounts anywhere in the body', () => {
		expect(parseCheckoutRequest({ ...VALID, amount: 100 })).toBeNull();
		expect(parseCheckoutRequest({ ...VALID, account: 'acct_1' })).toBeNull();
		expect(parseCheckoutRequest({ ...VALID, items: [{ variantId: 'trail-mug-blue', quantity: 1, price: 1 }] })).toBeNull();
		expect(parseCheckoutRequest({ ...VALID, fee: 0 })).toBeNull();
	});

	it('refuses an empty or oversized cart and malformed fields', () => {
		expect(parseCheckoutRequest({ ...VALID, items: [] })).toBeNull();
		expect(parseCheckoutRequest({ ...VALID, items: Array.from({ length: 51 }, (_, index) => ({ variantId: `v-${index}`, quantity: 1 })) })).toBeNull();
		expect(parseCheckoutRequest({ ...VALID, shipTo: 'USA' })).toBeNull();
		expect(parseCheckoutRequest({ ...VALID, note: 'x'.repeat(501) })).toBeNull();
		expect(parseCheckoutRequest('items')).toBeNull();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run worker/services/store-payments/request.test.ts`
Expected: FAIL, "Cannot find module './request'".

- [ ] **Step 3: Write the parser**

```ts
/** What a store may send to start a checkout: variant ids, quantities, a ship-to country, return paths and a note. Pure. */

import { STORE_CART_MAX_LINES, type StoreCheckoutRequest } from '../../../shared/types/store-payments';

const REQUEST_KEYS = ['items', 'shipTo', 'successPath', 'cancelPath', 'note'];
const ITEM_KEYS = ['variantId', 'quantity'];
const MAX_PATH = 200;
const MAX_NOTE = 500;
const MAX_VARIANT_ID = 64;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return Object.keys(value).every((key) => keys.includes(key));
}

/** A path on the store, or the fallback: never `//host`, a scheme, a backslash or a control character. */
export function safeReturnPath(value: unknown, fallback: string): string {
	if (typeof value !== 'string' || value.length > MAX_PATH) return fallback;
	if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || CONTROL_CHARACTER.test(value)) return fallback;
	return value;
}

/** Null for any other shape, including one carrying an amount, price, fee or account: Estori derives those itself. */
export function parseCheckoutRequest(body: unknown): StoreCheckoutRequest | null {
	if (!isObject(body) || !hasOnly(body, REQUEST_KEYS)) return null;
	const { items, shipTo, successPath, cancelPath, note } = body;
	if (!Array.isArray(items) || items.length === 0 || items.length > STORE_CART_MAX_LINES) return null;
	const parsedItems: StoreCheckoutRequest['items'] = [];
	for (const item of items) {
		if (!isObject(item) || !hasOnly(item, ITEM_KEYS)) return null;
		const { variantId, quantity } = item;
		if (typeof variantId !== 'string' || variantId.length === 0 || variantId.length > MAX_VARIANT_ID) return null;
		if (typeof quantity !== 'number') return null;
		parsedItems.push({ variantId, quantity });
	}
	if (typeof shipTo !== 'string' || !/^[A-Za-z]{2}$/.test(shipTo)) return null;
	if (successPath !== undefined && typeof successPath !== 'string') return null;
	if (cancelPath !== undefined && typeof cancelPath !== 'string') return null;
	if (note !== undefined && (typeof note !== 'string' || note.length > MAX_NOTE)) return null;
	return {
		items: parsedItems,
		shipTo: shipTo.toUpperCase(),
		...(successPath !== undefined && { successPath }),
		...(cancelPath !== undefined && { cancelPath }),
		...(note !== undefined && { note }),
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy npx vitest run worker/services/store-payments/request.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/services/store-payments/request.ts worker/services/store-payments/request.test.ts
git commit -m "feat(store-payments): parse checkout requests and keep return paths on the store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pricing a cart

**Files:**
- Create: `worker/services/store-payments/pricing.ts`
- Test: `worker/services/store-payments/pricing.test.ts`

**Interfaces:**
- Consumes: Task 1 types; `checkCart`, `CheckoutCart`, `CatalogSupplier` from `shared/types/catalog.ts`.
- Produces:
  - `CatalogLock = { ok: true; catalogVariantId: string; supplier: CatalogSupplier; supplierVariantId: string; lockedCatalogPriceCents: number } | { ok: false; catalogVariantId: string; reason: 'unknown' | 'unavailable' | 'ships_to_unsupported' }`;
  - `CartContext = Pick<PricedCart, 'mode' | 'storeAppId' | 'storeVersionId' | 'commitHash' | 'sellerStripeAccountId'>`;
  - `priceCart(input: { manifest: StoreManifest; request: StoreCheckoutRequest; catalogLocks: ReadonlyMap<string, CatalogLock>; context: CartContext }): PriceCartResult`, with `PriceCartResult = { ok: true; cart: PricedCart; applicationFeeCents: number } | { ok: false; reason: StoreCheckoutRefusal }`;
  - `toCheckoutCart(cart: PricedCart): CheckoutCart`;
  - `requestedCatalogVariantIds(manifest: StoreManifest, request: StoreCheckoutRequest): string[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import type { StoreManifest } from '../../../shared/types/store-payments';
import { priceCart, requestedCatalogVariantIds, toCheckoutCart, type CatalogLock } from './pricing';

const MANIFEST: StoreManifest = {
	version: 1,
	currency: 'usd',
	shipping: { countries: ['US', 'CA'], flatRateCents: 600, freeOverCents: 7500 },
	products: [
		{
			id: 'trail-mug',
			name: 'Trail Mug',
			variants: [
				{ id: 'trail-mug-blue', name: 'Blue', priceCents: 2000 },
				{ id: 'trail-mug-red', name: 'Red', priceCents: 2000, available: false },
			],
		},
		{ id: 'desk-lamp', name: 'Desk Lamp', variants: [{ id: 'desk-lamp-black', name: 'Black', priceCents: 3500, catalogVariantId: 'cv_lamp' }] },
		{ id: 'poster', name: 'Poster', variants: [{ id: 'poster-big', name: 'Big', priceCents: 1_000_000 }] },
	],
};

const CONTEXT = { mode: 'test', storeAppId: 'app_1', storeVersionId: null, commitHash: 'c0ffee', sellerStripeAccountId: 'acct_1' } as const;
const LAMP_LOCK: CatalogLock = { ok: true, catalogVariantId: 'cv_lamp', supplier: 'cjdropshipping', supplierVariantId: 'cj_vid_lamp', lockedCatalogPriceCents: 1200 };

function price(items: { variantId: string; quantity: number }[], options: { shipTo?: string; locks?: CatalogLock[] } = {}) {
	return priceCart({
		manifest: MANIFEST,
		request: { items, shipTo: options.shipTo ?? 'US' },
		catalogLocks: new Map((options.locks ?? [LAMP_LOCK]).map((lock) => [lock.catalogVariantId, lock])),
		context: CONTEXT,
	});
}

describe('priceCart', () => {
	it("prices a cart from the manifest, with the fee covering Stripe's processing", () => {
		const result = price([{ variantId: 'trail-mug-blue', quantity: 2 }]);
		expect(result).toEqual({
			ok: true,
			applicationFeeCents: 163,
			cart: {
				...CONTEXT,
				currency: 'usd',
				shipToCountry: 'US',
				lines: [{ kind: 'own', productId: 'trail-mug', variantId: 'trail-mug-blue', name: 'Trail Mug, Blue', quantity: 2, unitPriceCents: 2000 }],
				subtotalCents: 4000,
				shippingCents: 600,
				totalCents: 4600,
			},
		});
	});

	it('merges repeated variants into one line', () => {
		const result = price([
			{ variantId: 'trail-mug-blue', quantity: 1 },
			{ variantId: 'trail-mug-blue', quantity: 2 },
		]);
		expect(result.ok && result.cart.lines).toEqual([expect.objectContaining({ variantId: 'trail-mug-blue', quantity: 3 })]);
	});

	it('ships free at or above the threshold', () => {
		const result = price([{ variantId: 'trail-mug-blue', quantity: 4 }]);
		expect(result.ok && result.cart.shippingCents).toBe(0);
	});

	it('refuses unknown and sold-out variants, and countries the store does not ship to', () => {
		expect(price([{ variantId: 'nope', quantity: 1 }])).toEqual({ ok: false, reason: 'unknown_item' });
		expect(price([{ variantId: 'trail-mug-red', quantity: 1 }])).toEqual({ ok: false, reason: 'item_unavailable' });
		expect(price([{ variantId: 'trail-mug-blue', quantity: 1 }], { shipTo: 'FR' })).toEqual({ ok: false, reason: 'ships_to_unsupported' });
	});

	it("refuses quantities and totals outside one order's limits", () => {
		for (const quantity of [0, 100, 1.5]) {
			expect(price([{ variantId: 'trail-mug-blue', quantity }])).toEqual({ ok: false, reason: 'cart_limits' });
		}
		expect(price([{ variantId: 'poster-big', quantity: 2 }])).toEqual({ ok: false, reason: 'cart_limits' });
	});

	it('prices catalog lines from their lock, and takes the locked price in the fee', () => {
		const result = price([{ variantId: 'desk-lamp-black', quantity: 1 }]);
		expect(result.ok && result.cart.lines).toEqual([
			{
				kind: 'catalog',
				productId: 'desk-lamp',
				variantId: 'desk-lamp-black',
				name: 'Desk Lamp, Black',
				quantity: 1,
				unitPriceCents: 3500,
				catalogVariantId: 'cv_lamp',
				supplier: 'cjdropshipping',
				supplierVariantId: 'cj_vid_lamp',
				destinationCountry: 'US',
				lockedCatalogPriceCents: 1200,
			},
		]);
		// 4100 total: 1200 catalog + round(4100 x 2.9%) + 30.
		expect(result.ok && result.applicationFeeCents).toBe(1349);
	});

	it('refuses catalog lines that cannot be locked', () => {
		expect(price([{ variantId: 'desk-lamp-black', quantity: 1 }], { locks: [] })).toEqual({ ok: false, reason: 'unknown_item' });
		const refusals = { unknown: 'unknown_item', unavailable: 'item_unavailable', ships_to_unsupported: 'ships_to_unsupported' } as const;
		for (const [reason, refusal] of Object.entries(refusals)) {
			const lock = { ok: false, catalogVariantId: 'cv_lamp', reason } as CatalogLock;
			expect(price([{ variantId: 'desk-lamp-black', quantity: 1 }], { locks: [lock] })).toEqual({ ok: false, reason: refusal });
		}
	});

	it('refuses a catalog retail price under the minimum for its locked price', () => {
		const dearer: CatalogLock = { ...LAMP_LOCK, lockedCatalogPriceCents: 3400 };
		expect(price([{ variantId: 'desk-lamp-black', quantity: 1 }], { locks: [dearer] })).toEqual({ ok: false, reason: 'below_minimum_price' });
	});
});

describe('requestedCatalogVariantIds', () => {
	it('names each catalog variant the request asks for, once', () => {
		const request = { shipTo: 'US', items: [{ variantId: 'desk-lamp-black', quantity: 1 }, { variantId: 'trail-mug-blue', quantity: 1 }, { variantId: 'desk-lamp-black', quantity: 2 }] };
		expect(requestedCatalogVariantIds(MANIFEST, request)).toEqual(['cv_lamp']);
	});
});

describe('toCheckoutCart', () => {
	it('keeps what the catalog fee reads', () => {
		const result = price([{ variantId: 'desk-lamp-black', quantity: 1 }, { variantId: 'trail-mug-blue', quantity: 1 }]);
		if (!result.ok) throw new Error('expected a priced cart');
		expect(toCheckoutCart(result.cart)).toEqual({
			shippingCents: 600,
			shipToCountry: 'US',
			lines: [
				{ kind: 'catalog', unitPriceCents: 3500, quantity: 1, catalogVariantId: 'cv_lamp', supplier: 'cjdropshipping', supplierVariantId: 'cj_vid_lamp', lockedCatalogPriceCents: 1200 },
				{ kind: 'own', unitPriceCents: 2000, quantity: 1 },
			],
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run worker/services/store-payments/pricing.test.ts`
Expected: FAIL, "Cannot find module './pricing'".

- [ ] **Step 3: Write the pricing**

```ts
/** Prices a store cart from the store's manifest and locked catalog prices, never from the request. Pure. */

import { checkCart, type CatalogSupplier, type CheckoutCart } from '../../../shared/types/catalog';
import {
	STORE_CART_MAX_CENTS,
	STORE_CART_MAX_LINES,
	STORE_CART_MIN_CENTS,
	STORE_LINE_MAX_QUANTITY,
	type PricedCart,
	type PricedLine,
	type StoreCheckoutRefusal,
	type StoreCheckoutRequest,
	type StoreManifest,
	type StoreManifestProduct,
	type StoreManifestVariant,
} from '../../../shared/types/store-payments';

/** A catalog variant's price, locked for one destination when checkout starts. */
export type CatalogLock =
	| { ok: true; catalogVariantId: string; supplier: CatalogSupplier; supplierVariantId: string; lockedCatalogPriceCents: number }
	| { ok: false; catalogVariantId: string; reason: 'unknown' | 'unavailable' | 'ships_to_unsupported' };

export type CartContext = Pick<PricedCart, 'mode' | 'storeAppId' | 'storeVersionId' | 'commitHash' | 'sellerStripeAccountId'>;

export type PriceCartResult = { ok: true; cart: PricedCart; applicationFeeCents: number } | { ok: false; reason: StoreCheckoutRefusal };

const LOCK_REFUSALS: Readonly<Record<Extract<CatalogLock, { ok: false }>['reason'], StoreCheckoutRefusal>> = {
	unknown: 'unknown_item',
	unavailable: 'item_unavailable',
	ships_to_unsupported: 'ships_to_unsupported',
};

function refuse(reason: StoreCheckoutRefusal): PriceCartResult {
	return { ok: false, reason };
}

function variantsById(manifest: StoreManifest): Map<string, { product: StoreManifestProduct; variant: StoreManifestVariant }> {
	return new Map(manifest.products.flatMap((product) => product.variants.map((variant) => [variant.id, { product, variant }] as const)));
}

/** The catalog variants a request names, so checkout locks only those. */
export function requestedCatalogVariantIds(manifest: StoreManifest, request: StoreCheckoutRequest): string[] {
	const variants = variantsById(manifest);
	return [...new Set(request.items.flatMap((item) => variants.get(item.variantId)?.variant.catalogVariantId ?? []))];
}

export function toCheckoutCart(cart: PricedCart): CheckoutCart {
	return {
		lines: cart.lines.map((line) =>
			line.kind === 'catalog'
				? {
						kind: 'catalog',
						unitPriceCents: line.unitPriceCents,
						quantity: line.quantity,
						catalogVariantId: line.catalogVariantId,
						supplier: line.supplier,
						supplierVariantId: line.supplierVariantId,
						lockedCatalogPriceCents: line.lockedCatalogPriceCents,
					}
				: { kind: 'own', unitPriceCents: line.unitPriceCents, quantity: line.quantity },
		),
		shippingCents: cart.shippingCents,
		shipToCountry: cart.shipToCountry,
	};
}

function mergedQuantities(items: StoreCheckoutRequest['items']): Map<string, number> {
	const quantities = new Map<string, number>();
	for (const item of items) quantities.set(item.variantId, (quantities.get(item.variantId) ?? 0) + item.quantity);
	return quantities;
}

export function priceCart(input: {
	manifest: StoreManifest;
	request: StoreCheckoutRequest;
	catalogLocks: ReadonlyMap<string, CatalogLock>;
	context: CartContext;
}): PriceCartResult {
	const { manifest, request } = input;
	const quantities = mergedQuantities(request.items);
	if (quantities.size > STORE_CART_MAX_LINES) return refuse('cart_limits');
	for (const quantity of quantities.values()) {
		if (!Number.isInteger(quantity) || quantity < 1 || quantity > STORE_LINE_MAX_QUANTITY) return refuse('cart_limits');
	}
	if (!manifest.shipping.countries.includes(request.shipTo)) return refuse('ships_to_unsupported');

	const variants = variantsById(manifest);
	const lines: PricedLine[] = [];
	for (const [variantId, quantity] of quantities) {
		const found = variants.get(variantId);
		if (!found) return refuse('unknown_item');
		const { product, variant } = found;
		if (variant.available === false) return refuse('item_unavailable');
		const base = { productId: product.id, variantId, name: `${product.name}, ${variant.name}`, quantity, unitPriceCents: variant.priceCents };
		if (variant.catalogVariantId === undefined) {
			lines.push({ ...base, kind: 'own' });
			continue;
		}
		const lock = input.catalogLocks.get(variant.catalogVariantId);
		if (!lock) return refuse('unknown_item');
		if (!lock.ok) return refuse(LOCK_REFUSALS[lock.reason]);
		lines.push({
			...base,
			kind: 'catalog',
			catalogVariantId: lock.catalogVariantId,
			supplier: lock.supplier,
			supplierVariantId: lock.supplierVariantId,
			destinationCountry: request.shipTo,
			lockedCatalogPriceCents: lock.lockedCatalogPriceCents,
		});
	}

	const subtotalCents = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
	const { flatRateCents, freeOverCents } = manifest.shipping;
	const shippingCents = freeOverCents !== undefined && subtotalCents >= freeOverCents ? 0 : flatRateCents;
	const totalCents = subtotalCents + shippingCents;
	if (totalCents < STORE_CART_MIN_CENTS || totalCents > STORE_CART_MAX_CENTS) return refuse('cart_limits');

	const cart: PricedCart = { ...input.context, currency: 'usd', shipToCountry: request.shipTo, lines, subtotalCents, shippingCents, totalCents };
	const check = checkCart(toCheckoutCart(cart));
	if (!check.ok) return refuse(check.problem === 'below-minimum-price' ? 'below_minimum_price' : 'cart_limits');
	return { ok: true, cart, applicationFeeCents: check.applicationFeeCents };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy npx vitest run worker/services/store-payments/pricing.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/services/store-payments/pricing.ts worker/services/store-payments/pricing.test.ts
git commit -m "feat(store-payments): price carts from the manifest and locked catalog prices

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Store checkout and order tables

**Files:**
- Modify: `worker/database/schema.ts` (import line 11 area; tables after `catalogOrderItems`)
- Create: `migrations/0018_<generated>.sql` and meta (drizzle-kit)
- Test: `worker/database/store-payments-schema.test.ts`

**Interfaces:**
- Consumes: `STORE_MODES`, `STORE_CHECKOUT_STATUSES`, `STORE_PAYMENT_STATUSES`, `STORE_FULFILLMENT_STATUSES`, `STORE_LINE_KINDS` (Task 1).
- Produces: `schema.storeCheckouts`, `schema.storeOrders`, `schema.storeOrderItems`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

const migrations = import.meta.glob<string>('/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const allMigrationSql = Object.values(migrations).join('\n');

function indexNamed(table: Parameters<typeof getTableConfig>[0], name: string) {
	return getTableConfig(table).indexes.find((index) => index.config.name === name);
}

describe('store payments schema', () => {
	it('records each checkout as at most one order, numbered per store and mode', () => {
		expect(indexNamed(schema.storeOrders, 'store_orders_checkout_unique_idx')?.config.unique).toBe(true);
		expect(indexNamed(schema.storeOrders, 'store_orders_session_unique_idx')?.config.unique).toBe(true);
		expect(indexNamed(schema.storeOrders, 'store_orders_number_unique_idx')?.config.unique).toBe(true);
		expect(indexNamed(schema.storeCheckouts, 'store_checkouts_session_unique_idx')?.config.unique).toBe(true);
	});

	it('starts checkouts creating and orders paid and unfulfilled', () => {
		expect(schema.storeCheckouts.status.default).toBe('creating');
		expect(schema.storeCheckouts.status.enumValues).toEqual(['creating', 'open', 'completed', 'expired', 'failed']);
		expect(schema.storeOrders.paymentStatus.default).toBe('paid');
		expect(schema.storeOrders.fulfillmentStatus.default).toBe('unfulfilled');
		expect(schema.storeOrders.refundedCents.default).toBe(0);
		expect(schema.storeOrderItems.kind.enumValues).toEqual(['own', 'catalog']);
	});

	it('ships the three tables in a migration', () => {
		expect(allMigrationSql).toContain('CREATE TABLE `store_checkouts`');
		expect(allMigrationSql).toContain('CREATE TABLE `store_orders`');
		expect(allMigrationSql).toContain('CREATE TABLE `store_order_items`');
		expect(allMigrationSql).toContain('CREATE UNIQUE INDEX `store_orders_number_unique_idx`');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run worker/database/store-payments-schema.test.ts`
Expected: FAIL, `indexNamed(schema.storeOrders, ...)` throws or reads undefined (no `storeOrders` export).

- [ ] **Step 3: Add the tables**

Extend the `drizzle-orm/sqlite-core` import with `primaryKey`, add the shared import after the catalog one:

```ts
import { STORE_CHECKOUT_STATUSES, STORE_FULFILLMENT_STATUSES, STORE_LINE_KINDS, STORE_MODES, STORE_PAYMENT_STATUSES } from '../../shared/types/store-payments';
```

Add after `catalogOrderItems`:

```ts
/**
 * Store checkouts - a cart Estori priced and sent to Stripe. Financial records: no foreign key to apps, so they
 * outlive a deleted app.
 */
export const storeCheckouts = sqliteTable('store_checkouts', {
    id: text('id').primaryKey(),
    mode: text('mode', { enum: STORE_MODES }).notNull(),
    appId: text('app_id').notNull(),
    storeVersionId: text('store_version_id'),
    commitHash: text('commit_hash').notNull(),
    sellerUserId: text('seller_user_id').notNull(),
    sellerStripeAccountId: text('seller_stripe_account_id'),
    shipToCountry: text('ship_to_country').notNull(),
    // The PricedCart as JSON: what the shopper pays is fixed here, never re-read from the store.
    pricedCart: text('priced_cart').notNull(),
    subtotalCents: integer('subtotal_cents').notNull(),
    shippingCents: integer('shipping_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
    applicationFeeCents: integer('application_fee_cents').notNull(),
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    status: text('status', { enum: STORE_CHECKOUT_STATUSES }).notNull().default('creating'),
    successPath: text('success_path').notNull(),
    cancelPath: text('cancel_path').notNull(),
    note: text('note'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    sessionIdx: uniqueIndex('store_checkouts_session_unique_idx').on(table.stripeCheckoutSessionId),
    appIdx: index('store_checkouts_app_idx').on(table.appId),
}));

/** Store orders - one per paid checkout, numbered per store and mode. */
export const storeOrders = sqliteTable('store_orders', {
    id: text('id').primaryKey(),
    mode: text('mode', { enum: STORE_MODES }).notNull(),
    appId: text('app_id').notNull(),
    orderNumber: integer('order_number').notNull(),
    checkoutId: text('checkout_id').notNull(),
    sellerUserId: text('seller_user_id').notNull(),
    sellerStripeAccountId: text('seller_stripe_account_id'),
    storeVersionId: text('store_version_id'),
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    paymentStatus: text('payment_status', { enum: STORE_PAYMENT_STATUSES }).notNull().default('paid'),
    fulfillmentStatus: text('fulfillment_status', { enum: STORE_FULFILLMENT_STATUSES }).notNull().default('unfulfilled'),
    trackingNumber: text('tracking_number'),
    carrier: text('carrier'),
    subtotalCents: integer('subtotal_cents').notNull(),
    shippingCents: integer('shipping_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
    applicationFeeCents: integer('application_fee_cents').notNull(),
    refundedCents: integer('refunded_cents').notNull().default(0),
    currency: text('currency').notNull().default('usd'),
    customerEmail: text('customer_email'),
    customerName: text('customer_name'),
    // The shopper's address as JSON, for the seller to ship own products.
    shippingAddress: text('shipping_address'),
    note: text('note'),
    needsAttention: text('needs_attention'),
    revision: integer('revision').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    checkoutIdx: uniqueIndex('store_orders_checkout_unique_idx').on(table.checkoutId),
    sessionIdx: uniqueIndex('store_orders_session_unique_idx').on(table.stripeCheckoutSessionId),
    numberIdx: uniqueIndex('store_orders_number_unique_idx').on(table.appId, table.mode, table.orderNumber),
    paymentIntentIdx: index('store_orders_payment_intent_idx').on(table.stripePaymentIntentId),
    sellerIdx: index('store_orders_seller_idx').on(table.sellerUserId),
}));

/** Store order items - the priced lines, as the shopper paid for them. */
export const storeOrderItems = sqliteTable('store_order_items', {
    orderId: text('order_id').notNull().references(() => storeOrders.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    kind: text('kind', { enum: STORE_LINE_KINDS }).notNull(),
    productId: text('product_id').notNull(),
    variantId: text('variant_id').notNull(),
    name: text('name').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    catalogVariantId: text('catalog_variant_id'),
    lockedCatalogPriceCents: integer('locked_catalog_price_cents'),
}, (table) => ({
    pk: primaryKey({ columns: [table.orderId, table.lineNo] }),
}));
```

- [ ] **Step 4: Generate the migration and apply it locally**

Run: `rtk proxy npm run db:generate -- --name store_payments`
Expected: `migrations/0018_store_payments.sql` with the three `CREATE TABLE` statements and their indexes.

Apply to the local dev D1 the way migrations 0016 and 0017 were (the wrangler CLI can't open the dev server's newer state): run the SQL and insert the `d1_migrations` row in one sqlite3 transaction against `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<db>.sqlite`.

- [ ] **Step 5: Run test to verify it passes**

Run: `rtk proxy npx vitest run worker/database/store-payments-schema.test.ts worker/database/catalog-schema.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add worker/database/schema.ts migrations/0018_store_payments.sql migrations/meta worker/database/store-payments-schema.test.ts
git commit -m "feat(store-payments): store checkout, order and item tables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Store checkout and order services

**Files:**
- Create: `worker/services/store-payments/store.ts`
- Create: `worker/database/services/StoreCheckoutService.ts`, `worker/database/services/StoreOrderService.ts`
- Modify: `worker/database/index.ts` (export both)
- Test: `worker/database/services/StoreOrderService.test.ts`

**Interfaces:**
- Consumes: Task 4 tables; `ShippingAddress` from `worker/services/catalog/supplier.ts`.
- Produces:
  - `StoreCheckoutRecord`, `NewStoreOrder`, `NewStoreOrderItem`, `StoreOrderView` in `store.ts`;
  - `StoreCheckoutService`: `create(checkout: StoreCheckoutRecord)`, `attachSession(checkoutId, sessionId)`, `markFailed(checkoutId)`, `expire(checkoutId)`, `get(checkoutId): Promise<StoreCheckoutRecord | null>`;
  - `StoreOrderService`: `recordOrder(order: NewStoreOrder): Promise<'recorded' | 'already-recorded'>`, `getOrder(orderId): Promise<StoreOrderView | null>`, `listOrders(appId: string, limit?: number): Promise<StoreOrderView[]>`.

- [ ] **Step 1: Write the record types**

`worker/services/store-payments/store.ts`:

```ts
/** The records store payments read and write, independent of D1 so the orchestration is tested with fakes. */

import type {
	PricedCart,
	StoreCheckoutStatus,
	StoreFulfillmentStatus,
	StoreLineKind,
	StoreMode,
	StorePaymentStatus,
} from '../../../shared/types/store-payments';
import type { ShippingAddress } from '../catalog/supplier';

export interface StoreCheckoutRecord {
	id: string;
	mode: StoreMode;
	appId: string;
	storeVersionId: string | null;
	commitHash: string;
	sellerUserId: string;
	sellerStripeAccountId: string | null;
	shipToCountry: string;
	pricedCart: PricedCart;
	subtotalCents: number;
	shippingCents: number;
	totalCents: number;
	applicationFeeCents: number;
	status: StoreCheckoutStatus;
	successPath: string;
	cancelPath: string;
	note: string | null;
	createdAt: Date;
	expiresAt: Date;
}

export interface NewStoreOrderItem {
	lineNo: number;
	kind: StoreLineKind;
	productId: string;
	variantId: string;
	name: string;
	quantity: number;
	unitPriceCents: number;
	catalogVariantId: string | null;
	lockedCatalogPriceCents: number | null;
}

export interface NewStoreOrder {
	id: string;
	checkoutId: string;
	mode: StoreMode;
	appId: string;
	sellerUserId: string;
	sellerStripeAccountId: string | null;
	storeVersionId: string | null;
	stripeCheckoutSessionId: string | null;
	stripePaymentIntentId: string | null;
	subtotalCents: number;
	shippingCents: number;
	totalCents: number;
	applicationFeeCents: number;
	customerEmail: string | null;
	customerName: string | null;
	shippingAddress: ShippingAddress | null;
	note: string | null;
	/** Why the owner must look at this order, or null. */
	needsAttention: string | null;
	items: NewStoreOrderItem[];
	createdAt: Date;
}

export interface StoreOrderView {
	id: string;
	orderNumber: number;
	mode: StoreMode;
	appId: string;
	paymentStatus: StorePaymentStatus;
	fulfillmentStatus: StoreFulfillmentStatus;
	subtotalCents: number;
	shippingCents: number;
	totalCents: number;
	applicationFeeCents: number;
	currency: string;
	customerEmail: string | null;
	customerName: string | null;
	shippingAddress: ShippingAddress | null;
	note: string | null;
	needsAttention: string | null;
	stripeCheckoutSessionId: string | null;
	createdAt: Date;
	items: NewStoreOrderItem[];
}
```

- [ ] **Step 2: Write the failing test**

`worker/database/services/StoreOrderService.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { StoreOrderService } from './StoreOrderService';
import { recordingD1 } from '../test-support/recording-d1';
import type { NewStoreOrder } from '../../services/store-payments/store';

const ORDER: NewStoreOrder = {
	id: 'ord_1',
	checkoutId: 'chk_1',
	mode: 'test',
	appId: 'app_1',
	sellerUserId: 'u1',
	sellerStripeAccountId: 'acct_1',
	storeVersionId: null,
	stripeCheckoutSessionId: 'cs_1',
	stripePaymentIntentId: 'pi_1',
	subtotalCents: 4000,
	shippingCents: 600,
	totalCents: 4600,
	applicationFeeCents: 163,
	customerEmail: 'ada@example.com',
	customerName: 'Ada',
	shippingAddress: { name: 'Ada', line1: '1 Main St', line2: null, city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US', phone: null, email: 'ada@example.com' },
	note: null,
	needsAttention: null,
	items: [{ lineNo: 1, kind: 'own', productId: 'trail-mug', variantId: 'trail-mug-blue', name: 'Trail Mug, Blue', quantity: 2, unitPriceCents: 2000, catalogVariantId: null, lockedCatalogPriceCents: null }],
	createdAt: new Date(1_800_000_000_000),
};

/** The store's last order number is 4. */
const LAST_NUMBER = (sql: string): unknown[][] => (sql.toLowerCase().includes('max(') ? [[4]] : []);

describe('StoreOrderService.recordOrder', () => {
	it("writes the order after the store's last number, its items and the completed checkout in one batch", async () => {
		const { d1, batches } = recordingD1(LAST_NUMBER);
		const orders = new StoreOrderService({ DB: d1 } as unknown as Env);

		expect(await orders.recordOrder(ORDER)).toBe('recorded');
		expect(batches).toHaveLength(1);
		expect(batches[0].map((entry) => entry.sql.split(' ').slice(0, 3).join(' ').toLowerCase())).toEqual([
			'insert into "store_orders"',
			'insert into "store_order_items"',
			'update "store_checkouts" set',
		]);
		expect(batches[0][0].params).toContain(5);
		expect(batches[0][0].params).toContain(JSON.stringify(ORDER.shippingAddress));
	});

	it("writes each item in its own statement, so a 50-line cart stays under D1's 100 parameters per statement", async () => {
		const { d1, batches } = recordingD1(LAST_NUMBER);
		const orders = new StoreOrderService({ DB: d1 } as unknown as Env);
		const items = Array.from({ length: 50 }, (_, index) => ({ ...ORDER.items[0], lineNo: index + 1 }));

		expect(await orders.recordOrder({ ...ORDER, items })).toBe('recorded');
		expect(batches[0]).toHaveLength(52);
		expect(Math.max(...batches[0].map((entry) => entry.params.length))).toBeLessThanOrEqual(100);
	});

	it('answers already-recorded when the checkout already has an order', async () => {
		const { d1 } = recordingD1(LAST_NUMBER);
		const duplicate = { ...d1, batch: async () => Promise.reject(new Error('D1_ERROR: UNIQUE constraint failed: store_orders.checkout_id: SQLITE_CONSTRAINT')) };
		const orders = new StoreOrderService({ DB: duplicate } as unknown as Env);

		expect(await orders.recordOrder(ORDER)).toBe('already-recorded');
	});

	it('takes the next number when another order took it first', async () => {
		const { d1 } = recordingD1(LAST_NUMBER);
		let attempts = 0;
		const racing = {
			...d1,
			batch: async (statements: object[]) => {
				attempts += 1;
				if (attempts === 1) throw new Error('D1_ERROR: UNIQUE constraint failed: store_orders.app_id, store_orders.mode, store_orders.order_number: SQLITE_CONSTRAINT');
				return d1.batch(statements);
			},
		};
		const orders = new StoreOrderService({ DB: racing } as unknown as Env);

		expect(await orders.recordOrder(ORDER)).toBe('recorded');
		expect(attempts).toBe(2);
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `rtk proxy npx vitest run worker/database/services/StoreOrderService.test.ts`
Expected: FAIL, "Cannot find module './StoreOrderService'".

- [ ] **Step 4: Write the services**

`worker/database/services/StoreOrderService.ts`:

```ts
/** D1 reads and writes for store orders and their items. */

import { and, desc, eq, inArray, max } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import type { NewStoreOrder, NewStoreOrderItem, StoreOrderView } from '../../services/store-payments/store';
import type { ShippingAddress } from '../../services/catalog/supplier';

const NUMBERING_ATTEMPTS = 3;

function uniqueViolation(error: unknown): string | null {
    return error instanceof Error && error.message.includes('UNIQUE constraint failed') ? error.message : null;
}

export class StoreOrderService extends BaseService {
    /** One batch per attempt: the order, its items and its checkout. A second delivery of the same checkout writes nothing. */
    async recordOrder(order: NewStoreOrder): Promise<'recorded' | 'already-recorded'> {
        for (let attempt = 0; attempt < NUMBERING_ATTEMPTS; attempt++) {
            const last = await this.database
                .select({ number: max(schema.storeOrders.orderNumber) })
                .from(schema.storeOrders)
                .where(and(eq(schema.storeOrders.appId, order.appId), eq(schema.storeOrders.mode, order.mode)))
                .get();
            try {
                await this.database.batch([
                    this.database.insert(schema.storeOrders).values({
                        id: order.id,
                        mode: order.mode,
                        appId: order.appId,
                        orderNumber: (last?.number ?? 0) + 1,
                        checkoutId: order.checkoutId,
                        sellerUserId: order.sellerUserId,
                        sellerStripeAccountId: order.sellerStripeAccountId,
                        storeVersionId: order.storeVersionId,
                        stripeCheckoutSessionId: order.stripeCheckoutSessionId,
                        stripePaymentIntentId: order.stripePaymentIntentId,
                        subtotalCents: order.subtotalCents,
                        shippingCents: order.shippingCents,
                        totalCents: order.totalCents,
                        applicationFeeCents: order.applicationFeeCents,
                        customerEmail: order.customerEmail,
                        customerName: order.customerName,
                        shippingAddress: order.shippingAddress ? JSON.stringify(order.shippingAddress) : null,
                        note: order.note,
                        needsAttention: order.needsAttention,
                        createdAt: order.createdAt,
                        updatedAt: order.createdAt,
                    }),
                    // One statement per item: D1 binds at most 100 parameters per statement, and an item takes 10.
                    ...order.items.map((item) => this.database.insert(schema.storeOrderItems).values({ ...item, orderId: order.id })),
                    this.database
                        .update(schema.storeCheckouts)
                        .set({ status: 'completed' })
                        .where(eq(schema.storeCheckouts.id, order.checkoutId)),
                ]);
                return 'recorded';
            } catch (error) {
                const violation = uniqueViolation(error);
                if (!violation) throw error;
                // Another order took this number between the read and the write; read the last number again.
                if (violation.includes('order_number')) continue;
                return 'already-recorded';
            }
        }
        throw new Error(`Could not number the order for checkout ${order.checkoutId}`);
    }

    async getOrder(orderId: string): Promise<StoreOrderView | null> {
        const [order] = await this.ordersWhere(eq(schema.storeOrders.id, orderId), 1);
        return order ?? null;
    }

    async listOrders(appId: string, limit = 50): Promise<StoreOrderView[]> {
        return this.ordersWhere(eq(schema.storeOrders.appId, appId), limit);
    }

    private async ordersWhere(condition: ReturnType<typeof eq>, limit: number): Promise<StoreOrderView[]> {
        const orders = await this.database
            .select()
            .from(schema.storeOrders)
            .where(condition)
            .orderBy(desc(schema.storeOrders.createdAt))
            .limit(limit)
            .all();
        if (orders.length === 0) return [];
        const items = await this.database
            .select()
            .from(schema.storeOrderItems)
            .where(inArray(schema.storeOrderItems.orderId, orders.map((order) => order.id)))
            .all();
        return orders.map((order) => {
            const shippingAddress: ShippingAddress | null = order.shippingAddress ? JSON.parse(order.shippingAddress) : null;
            const lines: NewStoreOrderItem[] = items
                .filter((item) => item.orderId === order.id)
                .sort((a, b) => a.lineNo - b.lineNo)
                .map(({ orderId: _orderId, ...item }) => item);
            return {
                id: order.id,
                orderNumber: order.orderNumber,
                mode: order.mode,
                appId: order.appId,
                paymentStatus: order.paymentStatus,
                fulfillmentStatus: order.fulfillmentStatus,
                subtotalCents: order.subtotalCents,
                shippingCents: order.shippingCents,
                totalCents: order.totalCents,
                applicationFeeCents: order.applicationFeeCents,
                currency: order.currency,
                customerEmail: order.customerEmail,
                customerName: order.customerName,
                shippingAddress,
                note: order.note,
                needsAttention: order.needsAttention,
                stripeCheckoutSessionId: order.stripeCheckoutSessionId,
                createdAt: order.createdAt,
                items: lines,
            };
        });
    }
}
```

`worker/database/services/StoreCheckoutService.ts`:

```ts
/** D1 reads and writes for store checkouts. */

import { and, eq } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import type { PricedCart } from '../../../shared/types/store-payments';
import type { StoreCheckoutRecord } from '../../services/store-payments/store';

export class StoreCheckoutService extends BaseService {
    async create(checkout: StoreCheckoutRecord): Promise<void> {
        await this.database.insert(schema.storeCheckouts).values({ ...checkout, pricedCart: JSON.stringify(checkout.pricedCart) });
    }

    async attachSession(checkoutId: string, sessionId: string): Promise<void> {
        await this.database
            .update(schema.storeCheckouts)
            .set({ stripeCheckoutSessionId: sessionId, status: 'open' })
            .where(eq(schema.storeCheckouts.id, checkoutId));
    }

    async markFailed(checkoutId: string): Promise<void> {
        await this.database.update(schema.storeCheckouts).set({ status: 'failed' }).where(eq(schema.storeCheckouts.id, checkoutId));
    }

    /** Only an open checkout expires; a completed one keeps its status when Stripe's expiry event arrives late. */
    async expire(checkoutId: string): Promise<void> {
        await this.database
            .update(schema.storeCheckouts)
            .set({ status: 'expired' })
            .where(and(eq(schema.storeCheckouts.id, checkoutId), eq(schema.storeCheckouts.status, 'open')));
    }

    async get(checkoutId: string): Promise<StoreCheckoutRecord | null> {
        const row = await this.database.select().from(schema.storeCheckouts).where(eq(schema.storeCheckouts.id, checkoutId)).get();
        if (!row) return null;
        const { stripeCheckoutSessionId: _sessionId, pricedCart, ...checkout } = row;
        const cart: PricedCart = JSON.parse(pricedCart);
        return { ...checkout, pricedCart: cart };
    }
}
```

Export both from `worker/database/index.ts` next to `CatalogOrderService`:

```ts
export { StoreCheckoutService } from './services/StoreCheckoutService';
export { StoreOrderService } from './services/StoreOrderService';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `rtk proxy npx vitest run worker/database/services/StoreOrderService.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add worker/services/store-payments/store.ts worker/database/services/StoreCheckoutService.ts worker/database/services/StoreOrderService.ts worker/database/services/StoreOrderService.test.ts worker/database/index.ts
git commit -m "feat(store-payments): store checkout and order services on d1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Stripe Checkout sessions for stores

**Files:**
- Modify: `worker/services/payments/stripe-client.ts`
- Test: `worker/services/payments/stripe-client.test.ts`

**Interfaces:**
- Consumes: `request`, `encodeForm`, `CHECKOUT_SESSION_TTL_SECONDS`.
- Produces:
  - `StripeAddress`, `StripeShippingDetails`; `StripeCheckoutSession` gains optional `customer_details`, `collected_information`, `shipping_details`;
  - `StoreCheckoutSessionInput = { checkoutId: string; lines: readonly { name: string; quantity: number; unitPriceCents: number }[]; shippingCents: number; shipToCountry: string; applicationFeeCents: number; sellerStripeAccountId: string; metadata: Record<string, string>; successUrl: string; cancelUrl: string; nowMs: number }`;
  - `createStoreCheckoutSession(input: StoreCheckoutSessionInput): Promise<StripeCheckoutSession>`.

- [ ] **Step 1: Write the failing test**

Move `recordingFetch` from inside `describe('refunds for catalog items', ...)` to module level (right after the imports), unchanged, and append:

```ts
describe('store checkout sessions', () => {
	const INPUT = {
		checkoutId: 'chk_1',
		lines: [{ name: 'Trail Mug, Blue', quantity: 2, unitPriceCents: 2000 }],
		shippingCents: 600,
		shipToCountry: 'US',
		applicationFeeCents: 163,
		sellerStripeAccountId: 'acct_1',
		metadata: { kind: 'store_order', checkoutId: 'chk_1', storeAppId: 'app_1' },
		successUrl: 'https://store.test/__estori/return?session_id={CHECKOUT_SESSION_ID}',
		cancelUrl: 'https://store.test/cart',
		nowMs: 1_800_000_000_000,
	};

	it('charges the priced lines and shipping, with the fee and the seller as merchant', async () => {
		const { calls, fakeFetch } = recordingFetch({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' });
		await createStripeClient('sk_test_fake', fakeFetch).createStoreCheckoutSession(INPUT);

		expect(calls[0].url).toBe('https://api.stripe.com/v1/checkout/sessions');
		expect(new Headers(calls[0].init.headers).get('Idempotency-Key')).toBe('store-checkout-chk_1');
		const body = decodeURIComponent(String(calls[0].init.body));
		for (const part of [
			'line_items[0][quantity]=2',
			'line_items[0][price_data][currency]=usd',
			'line_items[0][price_data][unit_amount]=2000',
			'line_items[0][price_data][product_data][name]=Trail Mug, Blue',
			'shipping_address_collection[allowed_countries][0]=US',
			'shipping_options[0][shipping_rate_data][type]=fixed_amount',
			'shipping_options[0][shipping_rate_data][fixed_amount][amount]=600',
			'shipping_options[0][shipping_rate_data][display_name]=Shipping',
			'payment_method_types[0]=card',
			'payment_intent_data[application_fee_amount]=163',
			'payment_intent_data[on_behalf_of]=acct_1',
			'payment_intent_data[transfer_data][destination]=acct_1',
			'payment_intent_data[metadata][checkoutId]=chk_1',
			'metadata[kind]=store_order',
			'client_reference_id=chk_1',
			'success_url=https://store.test/__estori/return?session_id={CHECKOUT_SESSION_ID}',
			`expires_at=${1_800_000_000 + 35 * 60}`,
		]) {
			expect(body).toContain(part);
		}
	});

	it('labels free shipping', async () => {
		const { calls, fakeFetch } = recordingFetch({ id: 'cs_2', url: null });
		await createStripeClient('sk_test_fake', fakeFetch).createStoreCheckoutSession({ ...INPUT, shippingCents: 0 });
		expect(decodeURIComponent(String(calls[0].init.body))).toContain('shipping_options[0][shipping_rate_data][display_name]=Free shipping');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run worker/services/payments/stripe-client.test.ts`
Expected: FAIL, "createStoreCheckoutSession is not a function".

- [ ] **Step 3: Add the types and the method**

Before `StripeCheckoutSession`:

```ts
export interface StripeAddress {
	line1: string | null;
	line2: string | null;
	city: string | null;
	state: string | null;
	postal_code: string | null;
	country: string | null;
}

export interface StripeShippingDetails {
	name: string | null;
	address: StripeAddress | null;
}
```

Add to `StripeCheckoutSession`:

```ts
	customer_details?: { email: string | null; name: string | null; phone: string | null } | null;
	/** Where Stripe puts the collected shipping address from API version 2025-03-31. */
	collected_information?: { shipping_details: StripeShippingDetails | null } | null;
	/** Where earlier API versions put it. */
	shipping_details?: StripeShippingDetails | null;
```

After `CheckoutSessionInput`:

```ts
export interface StoreCheckoutSessionInput {
	checkoutId: string;
	lines: readonly { name: string; quantity: number; unitPriceCents: number }[];
	shippingCents: number;
	/** The one country Checkout may ship to: catalog prices were locked for it. */
	shipToCountry: string;
	applicationFeeCents: number;
	sellerStripeAccountId: string;
	metadata: Record<string, string>;
	successUrl: string;
	cancelUrl: string;
	nowMs: number;
}
```

Add to `StripeClient`:

```ts
	createStoreCheckoutSession(input: StoreCheckoutSessionInput): Promise<StripeCheckoutSession>;
```

Add to the returned object, after `createCheckoutSession`:

```ts
		// The seller is the merchant of record (on_behalf_of); a retried start reuses the session through its key.
		createStoreCheckoutSession: (input) =>
			request<StripeCheckoutSession>(
				'POST',
				'/checkout/sessions',
				{
					mode: 'payment',
					line_items: input.lines.map((line) => ({
						quantity: line.quantity,
						price_data: { currency: 'usd', unit_amount: line.unitPriceCents, product_data: { name: line.name } },
					})),
					shipping_address_collection: { allowed_countries: [input.shipToCountry] },
					shipping_options: [
						{
							shipping_rate_data: {
								type: 'fixed_amount',
								display_name: input.shippingCents === 0 ? 'Free shipping' : 'Shipping',
								fixed_amount: { amount: input.shippingCents, currency: 'usd' },
							},
						},
					],
					payment_method_types: ['card'],
					payment_intent_data: {
						application_fee_amount: input.applicationFeeCents,
						on_behalf_of: input.sellerStripeAccountId,
						transfer_data: { destination: input.sellerStripeAccountId },
						metadata: input.metadata,
					},
					metadata: input.metadata,
					client_reference_id: input.checkoutId,
					success_url: input.successUrl,
					cancel_url: input.cancelUrl,
					expires_at: Math.floor(input.nowMs / 1000) + CHECKOUT_SESSION_TTL_SECONDS,
				},
				`store-checkout-${input.checkoutId}`,
			),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy npx vitest run worker/services/payments/stripe-client.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/services/payments/stripe-client.ts worker/services/payments/stripe-client.test.ts
git commit -m "feat(payments): stripe checkout sessions for store orders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Recording a paid store session

**Files:**
- Create: `worker/services/store-payments/fulfill.ts`
- Test: `worker/services/store-payments/fulfill.test.ts`

**Interfaces:**
- Consumes: Task 3 `toCheckoutCart`; Task 5 types; Task 6 session types; `PaidCatalogCheckout` from `worker/services/catalog/record.ts`.
- Produces:
  - `RecordStoreOrderDeps = { getCheckout(checkoutId: string): Promise<StoreCheckoutRecord | null>; recordOrder(order: NewStoreOrder): Promise<'recorded' | 'already-recorded'>; handOffCatalogLines(paid: PaidCatalogCheckout): Promise<void>; now(): Date }`;
  - `RecordStoreOrderResult = { result: 'recorded' | 'already-recorded'; orderId: string; checkout: StoreCheckoutRecord } | { result: 'not-paid'; checkout: StoreCheckoutRecord } | { result: 'not-ours' }`;
  - `recordStoreOrder(deps, session): Promise<RecordStoreOrderResult>`; `shippingAddressOf(session): ShippingAddress | null`; `storeOrderIdFor(checkoutId: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import type { StripeCheckoutSession } from '../payments/stripe-client';
import type { PaidCatalogCheckout } from '../catalog/record';
import { recordStoreOrder, type RecordStoreOrderDeps } from './fulfill';
import type { NewStoreOrder, StoreCheckoutRecord } from './store';

const CHECKOUT: StoreCheckoutRecord = {
	id: 'chk_ab12',
	mode: 'test',
	appId: 'app_1',
	storeVersionId: null,
	commitHash: 'c0ffee',
	sellerUserId: 'u1',
	sellerStripeAccountId: 'acct_1',
	shipToCountry: 'US',
	pricedCart: {
		mode: 'test',
		storeAppId: 'app_1',
		storeVersionId: null,
		commitHash: 'c0ffee',
		sellerStripeAccountId: 'acct_1',
		currency: 'usd',
		shipToCountry: 'US',
		lines: [
			{ kind: 'own', productId: 'trail-mug', variantId: 'trail-mug-blue', name: 'Trail Mug, Blue', quantity: 1, unitPriceCents: 2000 },
			{
				kind: 'catalog',
				productId: 'desk-lamp',
				variantId: 'desk-lamp-black',
				name: 'Desk Lamp, Black',
				quantity: 1,
				unitPriceCents: 3500,
				catalogVariantId: 'cv_lamp',
				supplier: 'cjdropshipping',
				supplierVariantId: 'cj_vid_lamp',
				destinationCountry: 'US',
				lockedCatalogPriceCents: 1200,
			},
		],
		subtotalCents: 5500,
		shippingCents: 600,
		totalCents: 6100,
	},
	subtotalCents: 5500,
	shippingCents: 600,
	totalCents: 6100,
	applicationFeeCents: 1407,
	status: 'open',
	successPath: '/thanks',
	cancelPath: '/cart',
	note: null,
	createdAt: new Date(0),
	expiresAt: new Date(0),
};

const PAID: StripeCheckoutSession = {
	id: 'cs_1',
	url: null,
	payment_status: 'paid',
	status: 'complete',
	client_reference_id: 'chk_ab12',
	metadata: { kind: 'store_order', checkoutId: 'chk_ab12', storeAppId: 'app_1' },
	amount_total: 6100,
	currency: 'usd',
	payment_intent: 'pi_1',
	customer_details: { email: 'ada@example.com', name: 'Ada Lovelace', phone: '+15125550100' },
	collected_information: {
		shipping_details: { name: 'Ada Lovelace', address: { line1: '1 Main St', line2: null, city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' } },
	},
};

function fakeDeps(recordAs: 'recorded' | 'already-recorded' = 'recorded') {
	const orders: NewStoreOrder[] = [];
	const handedOff: PaidCatalogCheckout[] = [];
	const deps: RecordStoreOrderDeps = {
		getCheckout: async (id) => (id === CHECKOUT.id ? CHECKOUT : null),
		recordOrder: async (order) => {
			orders.push(order);
			return recordAs;
		},
		handOffCatalogLines: async (paid) => {
			handedOff.push(paid);
		},
		now: () => new Date(5),
	};
	return { deps, orders, handedOff };
}

describe('recordStoreOrder', () => {
	it("records a paid session from the checkout's prices and the shopper's details, and hands over catalog lines", async () => {
		const { deps, orders, handedOff } = fakeDeps();
		const result = await recordStoreOrder(deps, PAID);

		expect(result).toEqual({ result: 'recorded', orderId: 'ord_ab12', checkout: CHECKOUT });
		expect(orders[0]).toMatchObject({
			id: 'ord_ab12',
			checkoutId: 'chk_ab12',
			stripeCheckoutSessionId: 'cs_1',
			stripePaymentIntentId: 'pi_1',
			totalCents: 6100,
			applicationFeeCents: 1407,
			customerEmail: 'ada@example.com',
			customerName: 'Ada Lovelace',
			needsAttention: null,
		});
		expect(orders[0].items.map((item) => [item.lineNo, item.kind, item.catalogVariantId])).toEqual([
			[1, 'own', null],
			[2, 'catalog', 'cv_lamp'],
		]);
		const address = { name: 'Ada Lovelace', line1: '1 Main St', line2: null, city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US', phone: '+15125550100', email: 'ada@example.com' };
		expect(orders[0].shippingAddress).toEqual(address);
		expect(handedOff).toEqual([
			{
				checkoutSessionId: 'cs_1',
				paymentIntentId: 'pi_1',
				sellerUserId: 'u1',
				storeAppId: 'app_1',
				shippingAddress: address,
				cart: {
					shippingCents: 600,
					shipToCountry: 'US',
					lines: [
						{ kind: 'own', unitPriceCents: 2000, quantity: 1 },
						{ kind: 'catalog', unitPriceCents: 3500, quantity: 1, catalogVariantId: 'cv_lamp', supplier: 'cjdropshipping', supplierVariantId: 'cj_vid_lamp', lockedCatalogPriceCents: 1200 },
					],
				},
			},
		]);
	});

	it('records nothing for an unpaid session', async () => {
		const { deps, orders } = fakeDeps();
		expect(await recordStoreOrder(deps, { ...PAID, payment_status: 'unpaid' })).toEqual({ result: 'not-paid', checkout: CHECKOUT });
		expect(orders).toHaveLength(0);
	});

	it("leaves other sessions to their own handlers", async () => {
		const { deps, orders } = fakeDeps();
		expect(await recordStoreOrder(deps, { ...PAID, metadata: { listingId: 'l1' } })).toEqual({ result: 'not-ours' });
		expect(await recordStoreOrder(deps, { ...PAID, metadata: { kind: 'store_order', checkoutId: 'chk_other' } })).toEqual({ result: 'not-ours' });
		expect(orders).toHaveLength(0);
	});

	it('records a session that differs from its checkout, flagged for the owner, without buying from the supplier', async () => {
		const { deps, orders, handedOff } = fakeDeps();
		await recordStoreOrder(deps, { ...PAID, amount_total: 5000 });
		expect(orders[0].needsAttention).toBe('paid 5000 cents, expected 6100');
		expect(handedOff).toHaveLength(0);
	});

	it('hands catalog lines over again on a repeated delivery, since the hand-off is idempotent', async () => {
		const { deps, handedOff } = fakeDeps('already-recorded');
		expect((await recordStoreOrder(deps, PAID)).result).toBe('already-recorded');
		expect(handedOff).toHaveLength(1);
	});

	it('reads the address where earlier Stripe API versions put it', async () => {
		const { deps, orders } = fakeDeps();
		const details = PAID.collected_information?.shipping_details ?? null;
		await recordStoreOrder(deps, { ...PAID, collected_information: null, shipping_details: details });
		expect(orders[0].shippingAddress?.postalCode).toBe('78701');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run worker/services/store-payments/fulfill.test.ts`
Expected: FAIL, "Cannot find module './fulfill'".

- [ ] **Step 3: Write the recorder**

```ts
/**
 * Records a paid store Checkout session as one store order and hands its catalog lines to placement. The webhook and the
 * return page both call it with the session as Stripe's API returns it.
 */

import { STORE_ORDER_KIND } from '../../../shared/types/store-payments';
import type { PaidCatalogCheckout } from '../catalog/record';
import type { ShippingAddress } from '../catalog/supplier';
import type { StripeCheckoutSession } from '../payments/stripe-client';
import { toCheckoutCart } from './pricing';
import type { NewStoreOrder, StoreCheckoutRecord } from './store';

export interface RecordStoreOrderDeps {
	getCheckout(checkoutId: string): Promise<StoreCheckoutRecord | null>;
	recordOrder(order: NewStoreOrder): Promise<'recorded' | 'already-recorded'>;
	/** Idempotent per Checkout session, so a redelivery after a crash still hands the lines over. */
	handOffCatalogLines(paid: PaidCatalogCheckout): Promise<void>;
	now(): Date;
}

export type RecordStoreOrderResult =
	| { result: 'recorded' | 'already-recorded'; orderId: string; checkout: StoreCheckoutRecord }
	| { result: 'not-paid'; checkout: StoreCheckoutRecord }
	| { result: 'not-ours' };

/** The order id derives from the checkout id, so every retry writes the same order. */
export function storeOrderIdFor(checkoutId: string): string {
	return `ord_${checkoutId.replace(/^chk_/, '')}`;
}

export function shippingAddressOf(session: StripeCheckoutSession): ShippingAddress | null {
	const details = session.collected_information?.shipping_details ?? session.shipping_details ?? null;
	const address = details?.address;
	if (!address?.line1 || !address.city || !address.postal_code || !address.country) return null;
	return {
		name: details?.name ?? session.customer_details?.name ?? '',
		line1: address.line1,
		line2: address.line2 || null,
		city: address.city,
		region: address.state || null,
		postalCode: address.postal_code,
		countryCode: address.country,
		phone: session.customer_details?.phone ?? null,
		email: session.customer_details?.email ?? null,
	};
}

export async function recordStoreOrder(deps: RecordStoreOrderDeps, session: StripeCheckoutSession): Promise<RecordStoreOrderResult> {
	const metadata = session.metadata ?? {};
	if (metadata.kind !== STORE_ORDER_KIND || !metadata.checkoutId) return { result: 'not-ours' };
	const checkout = await deps.getCheckout(metadata.checkoutId);
	if (!checkout) return { result: 'not-ours' };
	if (session.payment_status !== 'paid') return { result: 'not-paid', checkout };

	const address = shippingAddressOf(session);
	// Sessions Estori created can't differ from their checkout. If one does, money was taken, so it is recorded and flagged.
	const problems = [
		session.amount_total !== checkout.totalCents && `paid ${session.amount_total} cents, expected ${checkout.totalCents}`,
		(session.currency ?? '').toLowerCase() !== 'usd' && `paid in ${session.currency}`,
		metadata.storeAppId !== checkout.appId && 'paid for another store',
		address?.countryCode !== checkout.shipToCountry && `ships to ${address?.countryCode ?? 'no address'}, expected ${checkout.shipToCountry}`,
	].filter((problem): problem is string => typeof problem === 'string');

	const orderId = storeOrderIdFor(checkout.id);
	const result = await deps.recordOrder({
		id: orderId,
		checkoutId: checkout.id,
		mode: checkout.mode,
		appId: checkout.appId,
		sellerUserId: checkout.sellerUserId,
		sellerStripeAccountId: checkout.sellerStripeAccountId,
		storeVersionId: checkout.storeVersionId,
		stripeCheckoutSessionId: session.id,
		stripePaymentIntentId: session.payment_intent,
		subtotalCents: checkout.subtotalCents,
		shippingCents: checkout.shippingCents,
		totalCents: checkout.totalCents,
		applicationFeeCents: checkout.applicationFeeCents,
		customerEmail: session.customer_details?.email ?? null,
		customerName: session.customer_details?.name ?? address?.name ?? null,
		shippingAddress: address,
		note: checkout.note,
		needsAttention: problems.length > 0 ? problems.join('; ') : null,
		items: checkout.pricedCart.lines.map((line, index) => ({
			lineNo: index + 1,
			kind: line.kind,
			productId: line.productId,
			variantId: line.variantId,
			name: line.name,
			quantity: line.quantity,
			unitPriceCents: line.unitPriceCents,
			catalogVariantId: line.kind === 'catalog' ? line.catalogVariantId : null,
			lockedCatalogPriceCents: line.kind === 'catalog' ? line.lockedCatalogPriceCents : null,
		})),
		createdAt: deps.now(),
	});

	// A flagged order waits for the owner instead of buying from the supplier.
	const hasCatalogLines = checkout.pricedCart.lines.some((line) => line.kind === 'catalog');
	if (hasCatalogLines && problems.length === 0 && address && session.payment_intent) {
		await deps.handOffCatalogLines({
			checkoutSessionId: session.id,
			paymentIntentId: session.payment_intent,
			sellerUserId: checkout.sellerUserId,
			storeAppId: checkout.appId,
			cart: toCheckoutCart(checkout.pricedCart),
			shippingAddress: address,
		});
	}
	return { result, orderId, checkout };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy npx vitest run worker/services/store-payments/fulfill.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/services/store-payments/fulfill.ts worker/services/store-payments/fulfill.test.ts
git commit -m "feat(store-payments): record paid store sessions once and hand over catalog lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: SpaceDO records the deployed manifest

**Files:**
- Create: `space/src/space/store-manifest.ts`
- Test: `space/src/space/store-manifest.test.ts`
- Modify: `space/src/space/deploy-engine.ts` (`BranchDeploymentBundle`, `buildBranchDeployment`, `deployBranch`)
- Modify: `space/src/space/durable-object.ts` (`deployments` table, new RPC `getStoreManifest`)

**Interfaces:**
- Produces: `storeManifestOf(files: Record<string, string>): string | null`; `BranchDeploymentBundle.storeManifest: string | null`; `SpaceDO.getStoreManifest(branch: string): Promise<{ commitHash: string; manifest: string | null } | null>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest"
import { STORE_MANIFEST_PATH, storeManifestOf } from "./store-manifest"

describe("storeManifestOf", () => {
  it("reads the price list at the repository root only", () => {
    expect(STORE_MANIFEST_PATH).toBe("estori-store.json")
    expect(storeManifestOf({ "estori-store.json": "{}", "src/index.ts": "" })).toBe("{}")
    expect(storeManifestOf({ "public/estori-store.json": "{}" })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run space/src/space/store-manifest.test.ts`
Expected: FAIL, "Cannot find module './store-manifest'".

- [ ] **Step 3: Write the helper and record it at deploy**

`space/src/space/store-manifest.ts`:

```ts
/** The store's price list. Mirrors STORE_MANIFEST_FILE in shared/types/store-payments.ts, which this package can't import. */
export const STORE_MANIFEST_PATH = "estori-store.json"

/** The raw manifest in a deployed tree, or null when the store has none. Validation happens in the worker. */
export function storeManifestOf(files: Record<string, string>): string | null {
  return files[STORE_MANIFEST_PATH] ?? null
}
```

In `deploy-engine.ts`:
- import `storeManifestOf` from `./store-manifest`;
- add `storeManifest: string | null` to `BranchDeploymentBundle`;
- in `buildBranchDeployment`, add `storeManifest: storeManifestOf(files),` to both returned bundles;
- in `deployBranch`, destructure `storeManifest` from the bundle and write it:

```ts
  ctx.sql.exec(
    `INSERT OR REPLACE INTO deployments
     (branch, commit_hash, main_module, modules, assets, asset_config, store_manifest, deployed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    branch,
    commitHash,
    mainModule,
    JSON.stringify(serializedModules),
    JSON.stringify(serializedAssets),
    assetConfig ? JSON.stringify(assetConfig) : "{}",
    storeManifest,
    now
  )
```

In `durable-object.ts`, add `store_manifest TEXT,` to the `CREATE TABLE IF NOT EXISTS deployments` columns (before `deployed_at`), the migration line after the `asset_config` one:

```ts
    try { this.ctx.storage.sql.exec(`ALTER TABLE deployments ADD COLUMN store_manifest TEXT`) } catch {}
```

and the RPC after `getDeployment`:

```ts
  /** The deployed branch's `estori-store.json` as committed, which prices checkout in previews. */
  async getStoreManifest(branch: string): Promise<{ commitHash: string; manifest: string | null } | null> {
    await this.ensureInit()
    const row = this.ctx.storage.sql
      .exec("SELECT commit_hash, store_manifest FROM deployments WHERE branch = ?", branch)
      .toArray()[0]
    if (!row) return null
    return { commitHash: row.commit_hash as string, manifest: (row.store_manifest as string | null) ?? null }
  }
```

- [ ] **Step 4: Run test to verify it passes, and typecheck the space package**

Run: `rtk proxy npx vitest run space/src/space/store-manifest.test.ts space/src/space/preview-headers.test.ts`
Expected: PASS, 2 files.
Run: `rtk proxy npx tsc --noEmit -p tsconfig.worker.json`
Expected: no errors outside `packages/artifacts-viewer` (the worker config compiles `space/` through `@space-do/space`; if it doesn't, run the space package's own `tsc` config instead).

- [ ] **Step 5: Commit**

```bash
git add space/src/space/store-manifest.ts space/src/space/store-manifest.test.ts space/src/space/deploy-engine.ts space/src/space/durable-object.ts
git commit -m "feat(space): record each deployment's store manifest

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The receipt cookie and the store script

**Files:**
- Create: `worker/services/store-payments/receipts.ts`, `worker/services/store-payments/store-script.ts`
- Test: `worker/services/store-payments/receipts.test.ts`

**Interfaces:**
- Consumes: `JWTUtils` (`signPayload`, `verifyPayload`); Task 5 `StoreOrderView`.
- Produces: `RECEIPT_COOKIE_NAME`, `ReceiptClaims`, `addReceiptOrder`, `receiptAllows`, `receiptCookieHeader`, `readReceiptCookie`, `signReceipt`, `verifyReceipt`, `receiptOf(order: StoreOrderView): StoreReceipt`; `STORE_SCRIPT: string`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { addReceiptOrder, readReceiptCookie, receiptAllows, receiptCookieHeader, receiptOf, signReceipt, verifyReceipt } from './receipts';
import { STORE_SCRIPT } from './store-script';
import type { StoreOrderView } from './store';

const ENV = { JWT_SECRET: 'receipt-test-secret-0123456789abcdef' };

describe('receipt claims', () => {
	it('keeps the newest 20 orders of one store, newest first, without repeats', () => {
		let claims = addReceiptOrder(null, 'app_1', 'ord_1');
		claims = addReceiptOrder(claims, 'app_1', 'ord_2');
		claims = addReceiptOrder(claims, 'app_1', 'ord_1');
		expect(claims).toEqual({ appId: 'app_1', orderIds: ['ord_1', 'ord_2'] });
		for (let index = 3; index <= 25; index++) claims = addReceiptOrder(claims, 'app_1', `ord_${index}`);
		expect(claims.orderIds).toHaveLength(20);
		expect(claims.orderIds[0]).toBe('ord_25');
		expect(addReceiptOrder(claims, 'app_2', 'ord_x')).toEqual({ appId: 'app_2', orderIds: ['ord_x'] });
	});

	it("shows an order only to a receipt from the same store that lists it", () => {
		const claims = { appId: 'app_1', orderIds: ['ord_1'] };
		expect(receiptAllows(claims, 'app_1', 'ord_1')).toBe(true);
		expect(receiptAllows(claims, 'app_1', 'ord_2')).toBe(false);
		expect(receiptAllows(claims, 'app_2', 'ord_1')).toBe(false);
		expect(receiptAllows(null, 'app_1', 'ord_1')).toBe(false);
	});
});

describe('the receipt cookie', () => {
	it("is signed, http-only and scoped to the store's platform path", async () => {
		const token = await signReceipt(ENV, { appId: 'app_1', orderIds: ['ord_1'] });
		expect(await verifyReceipt(ENV, token)).toEqual({ appId: 'app_1', orderIds: ['ord_1'] });
		expect(await verifyReceipt({ JWT_SECRET: 'another-secret-0123456789abcdefgh' }, token)).toBeNull();
		expect(await verifyReceipt(ENV, null)).toBeNull();

		const header = receiptCookieHeader(token, '/space/app_1/preview/main/__estori/', true);
		expect(header).toContain(`__estori_orders=${token}`);
		for (const attribute of ['Path=/space/app_1/preview/main/__estori/', 'HttpOnly', 'SameSite=Lax', 'Secure', `Max-Age=${90 * 24 * 60 * 60}`]) {
			expect(header).toContain(attribute);
		}
		const request = new Request('https://s.test/', { headers: { Cookie: `other=1; __estori_orders=${token}` } });
		expect(readReceiptCookie(request)).toBe(token);
	});
});

describe('receiptOf', () => {
	it('shows the city and country, never the street address or phone', () => {
		const order: StoreOrderView = {
			id: 'ord_1',
			orderNumber: 7,
			mode: 'test',
			appId: 'app_1',
			paymentStatus: 'paid',
			fulfillmentStatus: 'unfulfilled',
			subtotalCents: 4000,
			shippingCents: 600,
			totalCents: 4600,
			applicationFeeCents: 163,
			currency: 'usd',
			customerEmail: 'ada@example.com',
			customerName: 'Ada',
			shippingAddress: { name: 'Ada', line1: '1 Main St', line2: null, city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US', phone: '+15125550100', email: 'ada@example.com' },
			note: null,
			needsAttention: null,
			stripeCheckoutSessionId: 'cs_1',
			createdAt: new Date('2026-10-16T00:00:00Z'),
			items: [{ lineNo: 1, kind: 'own', productId: 'trail-mug', variantId: 'trail-mug-blue', name: 'Trail Mug, Blue', quantity: 2, unitPriceCents: 2000, catalogVariantId: null, lockedCatalogPriceCents: null }],
		};
		const receipt = receiptOf(order);
		expect(receipt).toEqual({
			orderId: 'ord_1',
			orderNumber: 7,
			createdAt: '2026-10-16T00:00:00.000Z',
			mode: 'test',
			paymentStatus: 'paid',
			items: [{ name: 'Trail Mug, Blue', quantity: 2, unitPriceCents: 2000 }],
			subtotalCents: 4000,
			shippingCents: 600,
			totalCents: 4600,
			shipCity: 'Austin',
			shipCountry: 'US',
			customerEmail: 'ada@example.com',
		});
		expect(JSON.stringify(receipt)).not.toContain('Main St');
	});
});

describe('the store script', () => {
	it('finds the platform from its own address and exposes store, checkout and order', () => {
		expect(STORE_SCRIPT).toContain('document.currentScript');
		for (const call of ["'/store'", "'/checkout'", "'/orders/'", 'window.Estori']) expect(STORE_SCRIPT).toContain(call);
		// Stripe Checkout can't be framed, so a framed store opens it in a new tab.
		expect(STORE_SCRIPT).toContain('window.open(');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run worker/services/store-payments/receipts.test.ts`
Expected: FAIL, "Cannot find module './receipts'".

- [ ] **Step 3: Write the receipts and the script**

`worker/services/store-payments/receipts.ts`:

```ts
/** The shopper's receipt cookie: a signed list of their latest orders at one store, so an order id alone reads nothing. */

import type { StoreReceipt } from '../../../shared/types/store-payments';
import { JWTUtils } from '../../utils/jwtUtils';
import type { StoreOrderView } from './store';

export const RECEIPT_COOKIE_NAME = '__estori_orders';
const RECEIPT_PURPOSE = 'store_receipts';
const RECEIPT_MAX_ORDERS = 20;
const RECEIPT_TTL_SECONDS = 90 * 24 * 60 * 60;

export interface ReceiptClaims {
	appId: string;
	orderIds: string[];
}

export function addReceiptOrder(claims: ReceiptClaims | null, appId: string, orderId: string): ReceiptClaims {
	const previous = claims?.appId === appId ? claims.orderIds.filter((id) => id !== orderId) : [];
	return { appId, orderIds: [orderId, ...previous].slice(0, RECEIPT_MAX_ORDERS) };
}

export function receiptAllows(claims: ReceiptClaims | null, appId: string, orderId: string): boolean {
	return claims !== null && claims.appId === appId && claims.orderIds.includes(orderId);
}

export function receiptCookieHeader(token: string, path: string, secure: boolean): string {
	return `${RECEIPT_COOKIE_NAME}=${token}; Path=${path}; Max-Age=${RECEIPT_TTL_SECONDS}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function readReceiptCookie(request: Request): string | null {
	for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
		const [name, ...value] = part.trim().split('=');
		if (name === RECEIPT_COOKIE_NAME) return value.join('=') || null;
	}
	return null;
}

export async function signReceipt(env: { JWT_SECRET: string }, claims: ReceiptClaims): Promise<string> {
	return JWTUtils.getInstance(env).signPayload({ ...claims, purpose: RECEIPT_PURPOSE }, RECEIPT_TTL_SECONDS);
}

export async function verifyReceipt(env: { JWT_SECRET: string }, token: string | null): Promise<ReceiptClaims | null> {
	if (!token) return null;
	const payload = await JWTUtils.getInstance(env).verifyPayload(token);
	if (!payload || payload.purpose !== RECEIPT_PURPOSE || typeof payload.appId !== 'string' || !Array.isArray(payload.orderIds)) return null;
	return { appId: payload.appId, orderIds: payload.orderIds.filter((id): id is string => typeof id === 'string') };
}

export function receiptOf(order: StoreOrderView): StoreReceipt {
	return {
		orderId: order.id,
		orderNumber: order.orderNumber,
		createdAt: order.createdAt.toISOString(),
		mode: order.mode,
		paymentStatus: order.paymentStatus,
		items: order.items.map((item) => ({ name: item.name, quantity: item.quantity, unitPriceCents: item.unitPriceCents })),
		subtotalCents: order.subtotalCents,
		shippingCents: order.shippingCents,
		totalCents: order.totalCents,
		shipCity: order.shippingAddress?.city ?? null,
		shipCountry: order.shippingAddress?.countryCode ?? null,
		customerEmail: order.customerEmail,
	};
}
```

`worker/services/store-payments/store-script.ts`:

```ts
/** `/__estori/store.js`: the only way a store reaches payments. It finds the platform path from its own address. */

export const STORE_SCRIPT = `(function () {
  var script = document.currentScript;
  var base = new URL(script.src, window.location.href).pathname.replace(/\\/__estori\\/store\\.js$/i, '') + '/__estori';
  function call(path, init) {
    return fetch(base + path, Object.assign({ credentials: 'same-origin' }, init)).then(function (response) {
      return response.json();
    });
  }
  window.Estori = {
    store: function () {
      return call('/store');
    },
    checkout: function (request) {
      return call('/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }).then(function (result) {
        if (result.ok) {
          // Stripe Checkout can't be framed: a framed store opens it in a new tab.
          if (window.top !== window.self) window.open(result.checkoutUrl, '_blank', 'noopener');
          else window.location.assign(result.checkoutUrl);
        }
        return result;
      });
    },
    order: function (orderId) {
      return call('/orders/' + encodeURIComponent(orderId));
    },
  };
})();
`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy npx vitest run worker/services/store-payments/receipts.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/services/store-payments/receipts.ts worker/services/store-payments/store-script.ts worker/services/store-payments/receipts.test.ts
git commit -m "feat(store-payments): signed receipts and the store script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Starting a checkout

**Files:**
- Create: `worker/services/store-payments/checkout.ts`
- Create: `worker/services/store-payments/catalog-locks.ts`
- Test: `worker/services/store-payments/checkout.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 3, 5, 6.
- Produces:
  - `StartCheckoutDeps = { loadManifest(): Promise<{ commitHash: string; text: string } | null>; sellerAccount(): Promise<{ stripeAccountId: string; paymentsEnabled: boolean } | null>; lockCatalogPrices(catalogVariantIds: readonly string[], shipToCountry: string): Promise<readonly CatalogLock[]>; saveCheckout(checkout: StoreCheckoutRecord): Promise<void>; createSession(input: StoreCheckoutSessionInput): Promise<{ id: string; url: string | null }>; attachSession(checkoutId: string, sessionId: string): Promise<void>; markFailed(checkoutId: string): Promise<void>; newCheckoutId(): string; nowMs(): number }`;
  - `StartCheckoutInput = { access: 'owner' | 'public'; stripeMode: 'test' | 'live' | null; appId: string; sellerUserId: string; body: unknown; storeBaseUrl: string }`;
  - `startStoreCheckout(deps, input): Promise<StoreCheckoutResponse>`; `storeInfoOf(manifest: StoreManifest, paymentsAvailable: boolean): StoreInfo`; `refusal(reason: StoreCheckoutRefusal): StoreCheckoutResponse`;
  - `lockCatalogPricesFor(env: Env, catalogVariantIds: readonly string[], shipToCountry: string): Promise<readonly CatalogLock[]>` in `catalog-locks.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import type { StoreManifest } from '../../../shared/types/store-payments';
import type { StoreCheckoutSessionInput } from '../payments/stripe-client';
import { startStoreCheckout, type StartCheckoutDeps, type StartCheckoutInput } from './checkout';
import type { CatalogLock } from './pricing';
import type { StoreCheckoutRecord } from './store';

const MANIFEST: StoreManifest = {
	version: 1,
	currency: 'usd',
	shipping: { countries: ['US'], flatRateCents: 600 },
	products: [
		{ id: 'trail-mug', name: 'Trail Mug', variants: [{ id: 'trail-mug-blue', name: 'Blue', priceCents: 2000 }] },
		{ id: 'desk-lamp', name: 'Desk Lamp', variants: [{ id: 'desk-lamp-black', name: 'Black', priceCents: 3500, catalogVariantId: 'cv_lamp' }] },
	],
};

const INPUT: StartCheckoutInput = {
	access: 'owner',
	stripeMode: 'test',
	appId: 'app_1',
	sellerUserId: 'u1',
	body: { items: [{ variantId: 'trail-mug-blue', quantity: 2 }], shipTo: 'US', successPath: '/thanks', cancelPath: '/cart' },
	storeBaseUrl: 'https://preview.test/space/app_1/preview/main',
};

function fakeDeps(overrides: Partial<StartCheckoutDeps> = {}) {
	const saved: StoreCheckoutRecord[] = [];
	const sessions: StoreCheckoutSessionInput[] = [];
	const locked: Array<{ ids: readonly string[]; country: string }> = [];
	const attached: string[] = [];
	const failed: string[] = [];
	const deps: StartCheckoutDeps = {
		loadManifest: async () => ({ commitHash: 'c0ffee', text: JSON.stringify(MANIFEST) }),
		sellerAccount: async () => ({ stripeAccountId: 'acct_1', paymentsEnabled: true }),
		lockCatalogPrices: async (ids, country) => {
			locked.push({ ids, country });
			const lock: CatalogLock = { ok: true, catalogVariantId: 'cv_lamp', supplier: 'cjdropshipping', supplierVariantId: 'cj_vid_lamp', lockedCatalogPriceCents: 1200 };
			return [lock];
		},
		saveCheckout: async (checkout) => {
			saved.push(checkout);
		},
		createSession: async (input) => {
			sessions.push(input);
			return { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' };
		},
		attachSession: async (_checkoutId, sessionId) => {
			attached.push(sessionId);
		},
		markFailed: async (checkoutId) => {
			failed.push(checkoutId);
		},
		newCheckoutId: () => 'chk_1',
		nowMs: () => 1_800_000_000_000,
		...overrides,
	};
	return { deps, saved, sessions, locked, attached, failed };
}

describe('startStoreCheckout', () => {
	it("saves the priced checkout, then sends the shopper to Stripe with the seller's account and the fee", async () => {
		const { deps, saved, sessions, attached } = fakeDeps();
		expect(await startStoreCheckout(deps, INPUT)).toEqual({ ok: true, checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_1' });

		expect(saved[0]).toMatchObject({ id: 'chk_1', mode: 'test', appId: 'app_1', commitHash: 'c0ffee', sellerUserId: 'u1', sellerStripeAccountId: 'acct_1', status: 'creating', totalCents: 4600, applicationFeeCents: 163, successPath: '/thanks', cancelPath: '/cart' });
		expect(saved[0].expiresAt.getTime()).toBe(1_800_000_000_000 + 35 * 60 * 1000);
		expect(sessions[0]).toMatchObject({
			checkoutId: 'chk_1',
			lines: [{ name: 'Trail Mug, Blue', quantity: 2, unitPriceCents: 2000 }],
			shippingCents: 600,
			shipToCountry: 'US',
			applicationFeeCents: 163,
			sellerStripeAccountId: 'acct_1',
			metadata: { kind: 'store_order', checkoutId: 'chk_1', storeAppId: 'app_1' },
			successUrl: 'https://preview.test/space/app_1/preview/main/__estori/return?session_id={CHECKOUT_SESSION_ID}',
			cancelUrl: 'https://preview.test/space/app_1/preview/main/cart',
		});
		expect(attached).toEqual(['cs_1']);
	});

	it('locks only the catalog variants the cart names, for its country', async () => {
		const { deps, locked, sessions } = fakeDeps();
		await startStoreCheckout(deps, { ...INPUT, body: { items: [{ variantId: 'desk-lamp-black', quantity: 1 }], shipTo: 'US' } });
		expect(locked).toEqual([{ ids: ['cv_lamp'], country: 'US' }]);
		expect(sessions[0].applicationFeeCents).toBe(1349);

		const ownOnly = fakeDeps();
		await startStoreCheckout(ownOnly.deps, INPUT);
		expect(ownOnly.locked).toEqual([]);
	});

	it('refuses public previews, live keys and sellers who cannot take payments, before pricing', async () => {
		const cases: Array<[Partial<StartCheckoutInput>, Partial<StartCheckoutDeps>, string]> = [
			[{ access: 'public' }, {}, 'demo_only'],
			[{ stripeMode: 'live' }, {}, 'payments_unavailable'],
			[{ stripeMode: null }, {}, 'payments_unavailable'],
			[{}, { sellerAccount: async () => null }, 'payments_unavailable'],
			[{}, { sellerAccount: async () => ({ stripeAccountId: 'acct_1', paymentsEnabled: false }) }, 'payments_unavailable'],
			[{}, { loadManifest: async () => null }, 'payments_unavailable'],
			[{}, { loadManifest: async () => ({ commitHash: 'c0ffee', text: '{' }) }, 'payments_unavailable'],
		];
		for (const [input, overrides, reason] of cases) {
			const { deps, saved, sessions } = fakeDeps(overrides);
			const response = await startStoreCheckout(deps, { ...INPUT, ...input });
			expect(response).toMatchObject({ ok: false, reason });
			expect(saved).toHaveLength(0);
			expect(sessions).toHaveLength(0);
		}
	});

	it('refuses a body that carries an amount, before reading the store', async () => {
		let manifestReads = 0;
		const { deps, sessions } = fakeDeps({
			loadManifest: async () => {
				manifestReads += 1;
				return { commitHash: 'c0ffee', text: JSON.stringify(MANIFEST) };
			},
		});
		const response = await startStoreCheckout(deps, { ...INPUT, body: { ...(INPUT.body as object), amount: 1 } });
		expect(response).toEqual({ ok: false, reason: 'invalid_request', message: "Your cart couldn't be read. Refresh the page and try again." });
		expect(manifestReads).toBe(0);
		expect(sessions).toHaveLength(0);
	});

	it('marks the checkout failed when Stripe refuses the session', async () => {
		const { deps, failed } = fakeDeps({
			createSession: async () => {
				throw new Error('The account must have card_payments');
			},
		});
		expect(await startStoreCheckout(deps, INPUT)).toMatchObject({ ok: false, reason: 'stripe_failed' });
		expect(failed).toEqual(['chk_1']);
	});

	it('keeps unsafe return paths on the store', async () => {
		const { deps, sessions } = fakeDeps();
		await startStoreCheckout(deps, { ...INPUT, body: { ...(INPUT.body as object), cancelPath: '//evil.example' } });
		expect(sessions[0].cancelUrl).toBe('https://preview.test/space/app_1/preview/main/');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run worker/services/store-payments/checkout.test.ts`
Expected: FAIL, "Cannot find module './checkout'".

- [ ] **Step 3: Write the orchestration and the catalog lock source**

`worker/services/store-payments/checkout.ts`:

```ts
/**
 * Starts a store checkout: who may pay, the cart priced from Estori's own records, the checkout saved before Stripe
 * hears of it, and the Checkout session. Previews take Stripe test-mode payments only, and only from the app's owner.
 */

import {
	STORE_CHECKOUT_MESSAGES,
	STORE_ORDER_KIND,
	STORE_PLATFORM_PREFIX,
	type StoreCheckoutRefusal,
	type StoreCheckoutResponse,
	type StoreInfo,
	type StoreManifest,
} from '../../../shared/types/store-payments';
import type { StoreCheckoutSessionInput } from '../payments/stripe-client';
import { parseStoreManifest } from './manifest';
import { priceCart, requestedCatalogVariantIds, type CatalogLock } from './pricing';
import { parseCheckoutRequest, safeReturnPath } from './request';
import type { StoreCheckoutRecord } from './store';

/** As long as template sales' sessions. */
const CHECKOUT_TTL_MS = 35 * 60 * 1000;

export interface StartCheckoutDeps {
	/** The deployed preview's `estori-store.json`, or null when it has none. */
	loadManifest(): Promise<{ commitHash: string; text: string } | null>;
	sellerAccount(): Promise<{ stripeAccountId: string; paymentsEnabled: boolean } | null>;
	lockCatalogPrices(catalogVariantIds: readonly string[], shipToCountry: string): Promise<readonly CatalogLock[]>;
	saveCheckout(checkout: StoreCheckoutRecord): Promise<void>;
	createSession(input: StoreCheckoutSessionInput): Promise<{ id: string; url: string | null }>;
	attachSession(checkoutId: string, sessionId: string): Promise<void>;
	markFailed(checkoutId: string): Promise<void>;
	newCheckoutId(): string;
	nowMs(): number;
}

export interface StartCheckoutInput {
	/** The owner's own preview, or one shown to anyone else. */
	access: 'owner' | 'public';
	/** From the platform's Stripe key; null when Stripe isn't configured. */
	stripeMode: 'test' | 'live' | null;
	appId: string;
	sellerUserId: string;
	body: unknown;
	/** The store's origin and base path, without a trailing slash. */
	storeBaseUrl: string;
}

export function refusal(reason: StoreCheckoutRefusal): StoreCheckoutResponse {
	return { ok: false, reason, message: STORE_CHECKOUT_MESSAGES[reason] };
}

export function storeInfoOf(manifest: StoreManifest, paymentsAvailable: boolean): StoreInfo {
	return { mode: 'test', paymentsAvailable, currency: manifest.currency, shipping: manifest.shipping, products: manifest.products };
}

export async function startStoreCheckout(deps: StartCheckoutDeps, input: StartCheckoutInput): Promise<StoreCheckoutResponse> {
	if (input.access !== 'owner') return refusal('demo_only');
	if (input.stripeMode !== 'test') return refusal('payments_unavailable');
	const request = parseCheckoutRequest(input.body);
	if (!request) return refusal('invalid_request');

	const seller = await deps.sellerAccount();
	if (!seller?.paymentsEnabled) return refusal('payments_unavailable');
	const file = await deps.loadManifest();
	const parsed = file ? parseStoreManifest(file.text) : null;
	if (!file || !parsed?.ok) return refusal('payments_unavailable');

	const catalogVariantIds = requestedCatalogVariantIds(parsed.manifest, request);
	const locks = catalogVariantIds.length > 0 ? await deps.lockCatalogPrices(catalogVariantIds, request.shipTo) : [];
	const priced = priceCart({
		manifest: parsed.manifest,
		request,
		catalogLocks: new Map(locks.map((lock) => [lock.catalogVariantId, lock])),
		context: { mode: 'test', storeAppId: input.appId, storeVersionId: null, commitHash: file.commitHash, sellerStripeAccountId: seller.stripeAccountId },
	});
	if (!priced.ok) return refusal(priced.reason);

	const { cart } = priced;
	const checkoutId = deps.newCheckoutId();
	const nowMs = deps.nowMs();
	const cancelPath = safeReturnPath(request.cancelPath, '/');
	await deps.saveCheckout({
		id: checkoutId,
		mode: cart.mode,
		appId: input.appId,
		storeVersionId: null,
		commitHash: cart.commitHash,
		sellerUserId: input.sellerUserId,
		sellerStripeAccountId: seller.stripeAccountId,
		shipToCountry: cart.shipToCountry,
		pricedCart: cart,
		subtotalCents: cart.subtotalCents,
		shippingCents: cart.shippingCents,
		totalCents: cart.totalCents,
		applicationFeeCents: priced.applicationFeeCents,
		status: 'creating',
		successPath: safeReturnPath(request.successPath, '/'),
		cancelPath,
		note: request.note ?? null,
		createdAt: new Date(nowMs),
		expiresAt: new Date(nowMs + CHECKOUT_TTL_MS),
	});

	let session: { id: string; url: string | null };
	try {
		session = await deps.createSession({
			checkoutId,
			lines: cart.lines.map((line) => ({ name: line.name, quantity: line.quantity, unitPriceCents: line.unitPriceCents })),
			shippingCents: cart.shippingCents,
			shipToCountry: cart.shipToCountry,
			applicationFeeCents: priced.applicationFeeCents,
			sellerStripeAccountId: seller.stripeAccountId,
			metadata: { kind: STORE_ORDER_KIND, checkoutId, storeAppId: input.appId },
			successUrl: `${input.storeBaseUrl}${STORE_PLATFORM_PREFIX}/return?session_id={CHECKOUT_SESSION_ID}`,
			cancelUrl: `${input.storeBaseUrl}${cancelPath}`,
			nowMs,
		});
	} catch {
		await deps.markFailed(checkoutId);
		return refusal('stripe_failed');
	}
	if (!session.url) {
		await deps.markFailed(checkoutId);
		return refusal('stripe_failed');
	}
	await deps.attachSession(checkoutId, session.id);
	return { ok: true, checkoutUrl: session.url };
}
```

`worker/services/store-payments/catalog-locks.ts`:

```ts
/**
 * Catalog price locks for checkout. Catalog lines are refused until the catalog connection supplies prices, as the
 * checkout spec rules: "catalog lines are designed in here but refused until the catalog ships".
 */

import type { CatalogLock } from './pricing';

export async function lockCatalogPricesFor(_env: Env, catalogVariantIds: readonly string[], _shipToCountry: string): Promise<readonly CatalogLock[]> {
	return catalogVariantIds.map((catalogVariantId) => ({ ok: false, catalogVariantId, reason: 'unknown' }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy npx vitest run worker/services/store-payments/checkout.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/services/store-payments/checkout.ts worker/services/store-payments/catalog-locks.ts worker/services/store-payments/checkout.test.ts
git commit -m "feat(store-payments): start store checkouts from estori's own prices

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The platform paths on previews, and the webhook

**Files:**
- Create: `worker/api/handlers/store-platform.ts`, `worker/services/store-payments/wiring.ts`
- Modify: `worker/api/handlers/space-preview.ts`, `worker/api/controllers/payments/webhook.ts`
- Test: `worker/api/handlers/store-platform.test.ts`

**Interfaces:**
- Consumes: Tasks 1-10; `AppService.checkAppOwnership`, `StripeConnectService`, `stripeFromEnv`, `accountFlags`, `PUBLIC_PREVIEW_SUBJECT`, `recordPaidCatalogOrder`, `CatalogOrderService`, `generateId`.
- Produces: `matchStorePlatformPath(pathname: string): { basePath: string; platformPath: string } | null`; `handleStorePlatform(request, env, target: StorePlatformTarget): Promise<Response>`; `recordStoreOrderDeps(env: Env): RecordStoreOrderDeps`; `recordStoreSession(env: Env, sessionId: string): Promise<RecordStoreOrderResult>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { matchStorePlatformPath } from './store-platform';

const sources = import.meta.glob<string>(['/worker/api/handlers/space-preview.ts', '/worker/api/controllers/payments/webhook.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('matchStorePlatformPath', () => {
	it('claims every spelling of the platform prefix on a preview', () => {
		for (const path of ['/__estori/store.js', '/__ESTORI/checkout', '/%5F%5Festori/store', '/%255F%255Festori/store', '/__estori']) {
			const match = matchStorePlatformPath(`/space/app_1/preview/main${path}`);
			expect(match?.basePath).toBe('/space/app_1/preview/main');
			expect(match?.platformPath.startsWith('/__estori')).toBe(true);
		}
		expect(matchStorePlatformPath('/space/app_1/preview/main/__ESTORI/Checkout')?.platformPath).toBe('/__estori/checkout');
	});

	it("leaves the store's own paths to the store", () => {
		for (const path of ['/space/app_1/preview/main/', '/space/app_1/preview/main/shop/__estori', '/space/app_1/preview/main/__estorix', '/api/apps']) {
			expect(matchStorePlatformPath(path)).toBeNull();
		}
	});
});

describe('preview wiring', () => {
	it('answers platform paths before anything reaches SpaceDO', () => {
		const preview = source('/worker/api/handlers/space-preview.ts');
		const serve = preview.slice(preview.indexOf('async function serveAuthorizedPreview('));
		expect(serve.indexOf('matchStorePlatformPath(')).toBeGreaterThan(-1);
		expect(serve.indexOf('matchStorePlatformPath(')).toBeLessThan(serve.indexOf('forwardToSpacePreview('));
		// Every authorized request goes through serveAuthorizedPreview; no other path forwards.
		expect(preview.match(/forwardToSpacePreview\(request, env, spaceName\)/g)).toHaveLength(1);
	});

	it('routes store sessions to the store recorder before the template path', () => {
		const webhook = source('/worker/api/controllers/payments/webhook.ts');
		expect(webhook.indexOf('recordStoreSession(env, object.id)')).toBeGreaterThan(-1);
		expect(webhook.indexOf('recordStoreSession(env, object.id)')).toBeLessThan(webhook.indexOf('fulfillCheckoutSession('));
		expect(webhook).toContain("event.type === 'checkout.session.expired'");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run worker/api/handlers/store-platform.test.ts`
Expected: FAIL, "Cannot find module './store-platform'".

- [ ] **Step 3: Write the shared wiring**

`worker/services/store-payments/wiring.ts`:

```ts
/** D1 and Stripe wiring for recording store orders, shared by the webhook and the return page. */

import { CatalogOrderService, StoreCheckoutService, StoreOrderService } from '../../database';
import { generateId } from '../../utils/idGenerator';
import { recordPaidCatalogOrder } from '../catalog/record';
import { stripeFromEnv } from '../payments/config';
import { recordStoreOrder, type RecordStoreOrderDeps, type RecordStoreOrderResult } from './fulfill';

export function recordStoreOrderDeps(env: Env): RecordStoreOrderDeps {
	const checkouts = new StoreCheckoutService(env);
	const orders = new StoreOrderService(env);
	return {
		getCheckout: (checkoutId) => checkouts.get(checkoutId),
		recordOrder: (order) => orders.recordOrder(order),
		handOffCatalogLines: async (paid) => {
			await recordPaidCatalogOrder({ store: new CatalogOrderService(env), newId: generateId, now: () => new Date() }, paid);
		},
		now: () => new Date(),
	};
}

/** Records from the session as Stripe's API returns it, never from an event payload. */
export async function recordStoreSession(env: Env, sessionId: string): Promise<RecordStoreOrderResult> {
	const stripe = stripeFromEnv(env);
	if (!stripe) throw new Error('Stripe is not configured');
	return recordStoreOrder(recordStoreOrderDeps(env), await stripe.retrieveCheckoutSession(sessionId));
}
```

- [ ] **Step 4: Write the platform handler**

`worker/api/handlers/store-platform.ts`:

```ts
/**
 * The platform's paths on a store's address (`/__estori/*`): the store script, store data, checkout, the return from
 * Stripe and receipts. They are answered here, before SpaceDO, so generated code never handles payments.
 */

import { STORE_CHECKOUT_MESSAGES, STORE_PLATFORM_PREFIX, type StoreCheckoutRefusal } from '../../../shared/types/store-payments';
import { createLogger } from '../../logger';
import { StoreCheckoutService, StoreOrderService, StripeConnectService } from '../../database';
import { AppService } from '../../database/services/AppService';
import { stripeFromEnv } from '../../services/payments/config';
import { accountFlags, type StripeClient } from '../../services/payments/stripe-client';
import { lockCatalogPricesFor } from '../../services/store-payments/catalog-locks';
import { refusal, startStoreCheckout, storeInfoOf } from '../../services/store-payments/checkout';
import { recordStoreOrder } from '../../services/store-payments/fulfill';
import { parseStoreManifest } from '../../services/store-payments/manifest';
import { addReceiptOrder, readReceiptCookie, receiptAllows, receiptCookieHeader, receiptOf, signReceipt, verifyReceipt } from '../../services/store-payments/receipts';
import { STORE_SCRIPT } from '../../services/store-payments/store-script';
import { recordStoreOrderDeps } from '../../services/store-payments/wiring';
import { PUBLIC_PREVIEW_SUBJECT } from '../../utils/spacePreviewToken';

const logger = createLogger('StorePlatform');

const PREVIEW_PATH = /^(\/space\/[^/]+\/preview\/[^/]+)(\/.*)?$/;
const MAX_BODY_BYTES = 16 * 1024;
/** Stored seller flags this old are refreshed from Stripe before a checkout. */
const SELLER_FLAGS_MAX_AGE_MS = 10 * 60 * 1000;
const REFUSAL_STATUS: Readonly<Record<StoreCheckoutRefusal, number>> = {
	payments_unavailable: 409,
	demo_only: 403,
	invalid_request: 400,
	unknown_item: 409,
	item_unavailable: 409,
	ships_to_unsupported: 409,
	below_minimum_price: 409,
	cart_limits: 400,
	stripe_failed: 502,
};

export interface StorePlatformTarget {
	appId: string;
	branch: string;
	/** `/space/<appId>/preview/<branch>`, as the request spelled it. */
	basePath: string;
	/** Decoded and lower-cased, starting with `/__estori`. */
	platformPath: string;
	/** The preview token's subject: the owner's user id, or the public subject. */
	previewUserId: string;
}

interface StoreManifestStub extends DurableObjectStub {
	getStoreManifest(branch: string): Promise<{ commitHash: string; manifest: string | null } | null>;
}

/** Decoded until stable and lower-cased, so no spelling of the prefix reaches the store. */
function normalizedPath(path: string): string {
	let current = path;
	for (let round = 0; round < 3; round++) {
		let decoded: string;
		try {
			decoded = decodeURIComponent(current);
		} catch {
			break;
		}
		if (decoded === current) break;
		current = decoded;
	}
	return current.toLowerCase();
}

export function matchStorePlatformPath(pathname: string): { basePath: string; platformPath: string } | null {
	const match = pathname.match(PREVIEW_PATH);
	if (!match) return null;
	const rest = normalizedPath(match[2] ?? '/');
	if (rest !== STORE_PLATFORM_PREFIX && !rest.startsWith(`${STORE_PLATFORM_PREFIX}/`)) return null;
	return { basePath: match[1], platformPath: rest };
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function stripeMode(env: Env): 'test' | 'live' | null {
	const key = env.STRIPE_SECRET_KEY;
	if (!key) return null;
	return key.startsWith('sk_test_') || key.startsWith('rk_test_') ? 'test' : 'live';
}

/** The owner's own preview takes test payments; any other viewer sees a demo. */
async function previewAccess(env: Env, target: StorePlatformTarget): Promise<'owner' | 'public'> {
	if (target.previewUserId === PUBLIC_PREVIEW_SUBJECT) return 'public';
	const ownership = await new AppService(env).checkAppOwnership(target.appId, target.previewUserId);
	return ownership.isOwner ? 'owner' : 'public';
}

async function loadManifest(env: Env, target: StorePlatformTarget): Promise<{ commitHash: string; text: string } | null> {
	const namespace = (env as unknown as { SPACE_DO?: DurableObjectNamespace }).SPACE_DO;
	if (!namespace) return null;
	const stub = namespace.get(namespace.idFromName(target.appId)) as unknown as StoreManifestStub;
	const deployed = await stub.getStoreManifest(target.branch);
	return deployed?.manifest ? { commitHash: deployed.commitHash, text: deployed.manifest } : null;
}

async function sellerAccount(env: Env, userId: string, stripe: StripeClient | null): Promise<{ stripeAccountId: string; paymentsEnabled: boolean } | null> {
	const accounts = new StripeConnectService(env);
	const stored = await accounts.getByUser(userId);
	if (!stored) return null;
	let flags = { chargesEnabled: stored.chargesEnabled, transfersActive: stored.transfersActive };
	if (stripe && Date.now() - stored.updatedAt.getTime() > SELLER_FLAGS_MAX_AGE_MS) {
		const account = await accounts.forgetIfMissing(stored, (accountId) => stripe.retrieveAccount(accountId));
		if (!account) return null;
		const fresh = accountFlags(account);
		await accounts.updateFlags(stored.stripeAccountId, fresh);
		flags = fresh;
	}
	return { stripeAccountId: stored.stripeAccountId, paymentsEnabled: flags.chargesEnabled && flags.transfersActive };
}

async function serveStoreInfo(env: Env, target: StorePlatformTarget): Promise<Response> {
	const file = await loadManifest(env, target);
	const parsed = file ? parseStoreManifest(file.text) : null;
	if (!parsed?.ok) return json({ error: 'This store has no valid estori-store.json' }, 404);
	const access = await previewAccess(env, target);
	const seller = access === 'owner' && stripeMode(env) === 'test' ? await sellerAccount(env, target.previewUserId, null) : null;
	return json(storeInfoOf(parsed.manifest, seller?.paymentsEnabled === true));
}

async function serveCheckout(request: Request, env: Env, target: StorePlatformTarget): Promise<Response> {
	const url = new URL(request.url);
	const sameOrigin = request.headers.get('Origin') === url.origin;
	const isJson = (request.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/json');
	if (!sameOrigin || !isJson) return json(refusal('invalid_request'), 400);
	const text = await request.text();
	if (text.length > MAX_BODY_BYTES) return json(refusal('invalid_request'), 413);
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		return json(refusal('invalid_request'), 400);
	}

	const stripe = stripeFromEnv(env);
	const checkouts = new StoreCheckoutService(env);
	const response = await startStoreCheckout(
		{
			loadManifest: () => loadManifest(env, target),
			sellerAccount: () => sellerAccount(env, target.previewUserId, stripe),
			lockCatalogPrices: (ids, country) => lockCatalogPricesFor(env, ids, country),
			saveCheckout: (checkout) => checkouts.create(checkout),
			createSession: (input) => {
				if (!stripe) throw new Error('Stripe is not configured');
				return stripe.createStoreCheckoutSession(input);
			},
			attachSession: (checkoutId, sessionId) => checkouts.attachSession(checkoutId, sessionId),
			markFailed: (checkoutId) => checkouts.markFailed(checkoutId),
			newCheckoutId: () => `chk_${crypto.randomUUID().replace(/-/g, '')}`,
			nowMs: () => Date.now(),
		},
		{
			access: await previewAccess(env, target),
			stripeMode: stripeMode(env),
			appId: target.appId,
			sellerUserId: target.previewUserId,
			body,
			storeBaseUrl: `${url.origin}${target.basePath}`,
		},
	);
	if (!response.ok) logger.info('Store checkout refused', { appId: target.appId, reason: response.reason });
	return json(response, response.ok ? 200 : REFUSAL_STATUS[response.reason]);
}

async function serveReturn(request: Request, env: Env, target: StorePlatformTarget): Promise<Response> {
	const url = new URL(request.url);
	const home = `${url.origin}${target.basePath}/`;
	const sessionId = url.searchParams.get('session_id');
	const stripe = stripeFromEnv(env);
	if (!sessionId || !stripe) return Response.redirect(home, 303);
	const session = await stripe.retrieveCheckoutSession(sessionId);
	if (session.metadata?.storeAppId !== target.appId) return Response.redirect(home, 303);

	const recorded = await recordStoreOrder(recordStoreOrderDeps(env), session);
	if (recorded.result === 'not-ours') return Response.redirect(home, 303);
	const successPath = recorded.checkout.successPath;
	const join = successPath.includes('?') ? '&' : '?';
	if (recorded.result === 'not-paid') return Response.redirect(`${url.origin}${target.basePath}${successPath}${join}status=processing`, 303);

	const claims = addReceiptOrder(await verifyReceipt(env, readReceiptCookie(request)), target.appId, recorded.orderId);
	const token = await signReceipt(env, claims);
	return new Response(null, {
		status: 303,
		headers: {
			Location: `${url.origin}${target.basePath}${successPath}${join}order=${encodeURIComponent(recorded.orderId)}`,
			'Set-Cookie': receiptCookieHeader(token, `${target.basePath}${STORE_PLATFORM_PREFIX}/`, url.protocol === 'https:'),
		},
	});
}

async function serveReceipt(request: Request, env: Env, target: StorePlatformTarget, orderId: string): Promise<Response> {
	const claims = await verifyReceipt(env, readReceiptCookie(request));
	if (!receiptAllows(claims, target.appId, orderId)) return json({ error: 'Order not found' }, 404);
	const order = await new StoreOrderService(env).getOrder(orderId);
	if (!order || order.appId !== target.appId) return json({ error: 'Order not found' }, 404);
	return json(receiptOf(order));
}

export async function handleStorePlatform(request: Request, env: Env, target: StorePlatformTarget): Promise<Response> {
	const path = target.platformPath;
	try {
		if (request.method === 'GET' && path === `${STORE_PLATFORM_PREFIX}/store.js`) {
			return new Response(STORE_SCRIPT, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' } });
		}
		if (request.method === 'GET' && path === `${STORE_PLATFORM_PREFIX}/store`) return await serveStoreInfo(env, target);
		if (request.method === 'POST' && path === `${STORE_PLATFORM_PREFIX}/checkout`) return await serveCheckout(request, env, target);
		if (request.method === 'GET' && path === `${STORE_PLATFORM_PREFIX}/return`) return await serveReturn(request, env, target);
		const receipt = path.match(/^\/__estori\/orders\/(ord_[a-z0-9]{1,64})$/);
		if (request.method === 'GET' && receipt) return await serveReceipt(request, env, target, receipt[1]);
		return json({ error: 'Not found' }, 404);
	} catch (error) {
		logger.error('Store platform request failed', { appId: target.appId, path, error });
		return path === `${STORE_PLATFORM_PREFIX}/checkout` ? json(refusal('stripe_failed'), 502) : json({ error: STORE_CHECKOUT_MESSAGES.payments_unavailable }, 500);
	}
}
```

- [ ] **Step 5: Route authorized preview requests through it**

In `worker/api/handlers/space-preview.ts`, import `handleStorePlatform` and `matchStorePlatformPath` from `./store-platform`, add before `handleSpacePreview`:

```ts
/** An authorized preview request: platform paths are answered here, everything else goes to the store. */
async function serveAuthorizedPreview(
	request: Request,
	env: Env,
	spaceName: string,
	branch: string,
	claims: SpacePreviewClaims,
): Promise<Response> {
	const platform = matchStorePlatformPath(new URL(request.url).pathname);
	if (platform) {
		return handleStorePlatform(request, env, { appId: spaceName, branch, ...platform, previewUserId: claims.userId });
	}
	return forwardToSpacePreview(request, env, spaceName);
}
```

and replace both `forwardToSpacePreview(request, env, spaceName)` calls in `handleSpacePreview` with `serveAuthorizedPreview(request, env, spaceName, branch, claims)`.

- [ ] **Step 6: Route store sessions in the webhook**

In `worker/api/controllers/payments/webhook.ts`, import `STORE_ORDER_KIND` from `../../../../shared/types/store-payments`, `StoreCheckoutService` from `../../../database`, and `recordStoreSession` from `../../../services/store-payments/wiring`. At the top of the completed-session branch, right after `if (!isCheckoutSession(object)) return;`:

```ts
        if (object.metadata?.kind === STORE_ORDER_KIND) {
            const stored = await recordStoreSession(env, object.id);
            logger.info('Store checkout session handled', { id: object.id, result: stored.result });
            return;
        }
```

and before the `account.updated` branch:

```ts
    if (event.type === 'checkout.session.expired' && isCheckoutSession(object) && object.metadata?.kind === STORE_ORDER_KIND && object.metadata.checkoutId) {
        await new StoreCheckoutService(env).expire(object.metadata.checkoutId);
        return;
    }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `rtk proxy npx vitest run worker/api/handlers/store-platform.test.ts worker/api/controllers/payments`
Expected: PASS, including the existing webhook and payments wiring tests.
Run: `rtk proxy npx tsc --noEmit -p tsconfig.worker.json`
Expected: no errors outside `packages/artifacts-viewer`.

- [ ] **Step 8: Commit**

```bash
git add worker/api/handlers/store-platform.ts worker/api/handlers/store-platform.test.ts worker/api/handlers/space-preview.ts worker/services/store-payments/wiring.ts worker/api/controllers/payments/webhook.ts
git commit -m "feat(store-payments): checkout, return and receipts on store previews

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The seller's orders API

**Files:**
- Create: `worker/api/controllers/stores/controller.ts`, `worker/api/routes/storeRoutes.ts`
- Modify: `worker/api/routes/index.ts`, `worker/database/services/CatalogOrderService.ts` (`progressForSessions`), `shared/types/store-payments.ts` (`StoreOrderSummary`, `StoreOrdersData`), `src/api-types.ts`, `src/lib/api-client.ts`
- Test: `worker/api/routes/store-routes-wiring.test.ts`, `worker/database/services/CatalogOrderService.test.ts`

**Interfaces:**
- Consumes: Task 5 `StoreOrderService.listOrders`.
- Produces: `GET /api/stores/:id/orders` (owner only) answering `StoreOrdersData = { orders: StoreOrderSummary[] }`; `CatalogOrderService.progressForSessions(sessionIds: readonly string[]): Promise<Map<string, CatalogItemProgress[]>>` with `CatalogItemProgress = { catalogVariantId: string; quantity: number; status: CatalogItemStatus; trackingNumber: string | null; carrier: string | null }`; `apiClient.getStoreOrders(appId)`.

- [ ] **Step 1: Write the failing tests**

`worker/api/routes/store-routes-wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/routes/storeRoutes.ts', '/worker/api/routes/index.ts'], { query: '?raw', import: 'default', eager: true });

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('store routes', () => {
	it("keeps a store's orders to its owner", () => {
		const routes = source('/worker/api/routes/storeRoutes.ts').split('\n');
		expect(routes.find((line) => line.includes("'/api/stores/:id/orders'"))).toContain('setAuthLevel(AuthConfig.ownerOnly)');
		expect(source('/worker/api/routes/index.ts')).toContain('setupStoreRoutes(app)');
	});
});
```

Append to `worker/database/services/CatalogOrderService.test.ts`:

```ts
describe('CatalogOrderService.progressForSessions', () => {
	it("groups each paid session's catalog items with their status and tracking", async () => {
		const { d1 } = recordingD1([
			['cs_1', 'cv_mug', 2, 'shipped', '9400111899223197428490', 'USPS'],
			['cs_1', 'cv_cap', 1, 'placed', null, null],
		]);
		const orders = new CatalogOrderService({ DB: d1 } as unknown as Env);
		const progress = await orders.progressForSessions(['cs_1']);
		expect(progress.get('cs_1')).toEqual([
			{ catalogVariantId: 'cv_mug', quantity: 2, status: 'shipped', trackingNumber: '9400111899223197428490', carrier: 'USPS' },
			{ catalogVariantId: 'cv_cap', quantity: 1, status: 'placed', trackingNumber: null, carrier: null },
		]);
		expect((await orders.progressForSessions([])).size).toBe(0);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy npx vitest run worker/api/routes/store-routes-wiring.test.ts worker/database/services/CatalogOrderService.test.ts`
Expected: FAIL, "Source not found: /worker/api/routes/storeRoutes.ts" and "progressForSessions is not a function".

- [ ] **Step 3: Add the shared types**

Append to `shared/types/store-payments.ts`:

```ts
import type { CatalogItemStatus } from './catalog';

/** A catalog item's progress, as the seller sees it on an order. */
export interface CatalogItemProgress {
	catalogVariantId: string;
	quantity: number;
	status: CatalogItemStatus;
	trackingNumber: string | null;
	carrier: string | null;
}

export interface StoreOrderSummary {
	id: string;
	orderNumber: number;
	mode: StoreMode;
	paymentStatus: StorePaymentStatus;
	fulfillmentStatus: StoreFulfillmentStatus;
	subtotalCents: number;
	shippingCents: number;
	totalCents: number;
	/** Estori's application fee: processing, plus the catalog price of catalog items. */
	applicationFeeCents: number;
	customerName: string | null;
	customerEmail: string | null;
	shipTo: { name: string; line1: string; line2: string | null; city: string; region: string | null; postalCode: string; countryCode: string } | null;
	needsAttention: string | null;
	createdAt: string;
	items: { name: string; kind: StoreLineKind; quantity: number; unitPriceCents: number }[];
	catalogItems: CatalogItemProgress[];
}

export interface StoreOrdersData {
	orders: StoreOrderSummary[];
}
```

(Merge the `CatalogItemStatus` import into the existing `import type { CatalogSupplier } from './catalog';` line.)

Re-export from `src/api-types.ts` next to the other shared re-exports:

```ts
export type { StoreOrdersData, StoreOrderSummary, CatalogItemProgress } from '../shared/types/store-payments';
```

- [ ] **Step 4: Add the catalog progress query**

In `CatalogOrderService` (import `inArray` and `CatalogItemProgress`):

```ts
    /** Catalog items of each paid Checkout session, for the seller's order list. */
    async progressForSessions(sessionIds: readonly string[]): Promise<Map<string, CatalogItemProgress[]>> {
        const progress = new Map<string, CatalogItemProgress[]>();
        if (sessionIds.length === 0) return progress;
        const rows = await this.database
            .select({
                sessionId: schema.catalogOrders.stripeCheckoutSessionId,
                catalogVariantId: schema.catalogOrderItems.catalogVariantId,
                quantity: schema.catalogOrderItems.quantity,
                status: schema.catalogOrderItems.status,
                trackingNumber: schema.catalogOrderItems.trackingNumber,
                carrier: schema.catalogOrderItems.carrier,
            })
            .from(schema.catalogOrderItems)
            .innerJoin(schema.catalogOrders, eq(schema.catalogOrderItems.orderId, schema.catalogOrders.id))
            .where(inArray(schema.catalogOrders.stripeCheckoutSessionId, [...sessionIds]))
            .all();
        for (const { sessionId, ...item } of rows) progress.set(sessionId, [...(progress.get(sessionId) ?? []), item]);
        return progress;
    }
```

- [ ] **Step 5: Add the controller and route**

`worker/api/controllers/stores/controller.ts`:

```ts
/** A store's orders, for its owner. */

import { BaseController } from '../baseController';
import { RouteContext } from '../../types/route-context';
import { ApiResponse, ControllerResponse } from '../types';
import { CatalogOrderService, StoreOrderService } from '../../../database';
import type { StoreOrdersData, StoreOrderSummary } from '../../../../shared/types/store-payments';
import type { StoreOrderView } from '../../../services/store-payments/store';
import type { CatalogItemProgress } from '../../../../shared/types/store-payments';

function summaryOf(order: StoreOrderView, catalogItems: CatalogItemProgress[]): StoreOrderSummary {
    const address = order.shippingAddress;
    return {
        id: order.id,
        orderNumber: order.orderNumber,
        mode: order.mode,
        paymentStatus: order.paymentStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        subtotalCents: order.subtotalCents,
        shippingCents: order.shippingCents,
        totalCents: order.totalCents,
        applicationFeeCents: order.applicationFeeCents,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        shipTo: address
            ? { name: address.name, line1: address.line1, line2: address.line2, city: address.city, region: address.region, postalCode: address.postalCode, countryCode: address.countryCode }
            : null,
        needsAttention: order.needsAttention,
        createdAt: order.createdAt.toISOString(),
        items: order.items.map((item) => ({ name: item.name, kind: item.kind, quantity: item.quantity, unitPriceCents: item.unitPriceCents })),
        catalogItems,
    };
}

export class StoreOrdersController extends BaseController {
    static async list(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<StoreOrdersData>>> {
        try {
            const appId = context.pathParams.id;
            if (!appId) return this.createErrorResponse<StoreOrdersData>('Missing store id', 400);
            const orders = await new StoreOrderService(env).listOrders(appId);
            const sessionIds = orders.flatMap((order) => order.stripeCheckoutSessionId ?? []);
            const progress = await new CatalogOrderService(env).progressForSessions(sessionIds);
            return this.createSuccessResponse<StoreOrdersData>({
                orders: orders.map((order) => summaryOf(order, (order.stripeCheckoutSessionId && progress.get(order.stripeCheckoutSessionId)) || [])),
            });
        } catch (error) {
            return this.handleError(error, 'list store orders') as ControllerResponse<ApiResponse<StoreOrdersData>>;
        }
    }
}
```

`worker/api/routes/storeRoutes.ts`:

```ts
import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { StoreOrdersController } from '../controllers/stores/controller';

/** A store's orders, for the app's owner. */
export function setupStoreRoutes(app: Hono<AppEnv>): void {
    app.get('/api/stores/:id/orders', setAuthLevel(AuthConfig.ownerOnly), adaptController(StoreOrdersController, StoreOrdersController.list));
}
```

Register in `worker/api/routes/index.ts` after `setupPaymentsRoutes(app);`:

```ts
    // A store's orders, for its owner
    setupStoreRoutes(app);
```

Add to `src/lib/api-client.ts`, next to the payments calls, following the file's existing `request` helper and `ApiResponse` pattern:

```ts
	async getStoreOrders(appId: string): Promise<ApiResponse<StoreOrdersData>> {
		return this.request<StoreOrdersData>(`/api/stores/${encodeURIComponent(appId)}/orders`);
	}
```

(Import `StoreOrdersData` from `@/api-types`; match the class's method style if it differs.)

- [ ] **Step 6: Run tests and typecheck**

Run: `rtk proxy npx vitest run worker/api/routes/store-routes-wiring.test.ts worker/database/services/CatalogOrderService.test.ts`
Expected: PASS.
Run: `rtk proxy npx tsc --noEmit -p tsconfig.app.json` and `rtk proxy npx tsc --noEmit -p tsconfig.worker.json`
Expected: no errors outside `packages/artifacts-viewer`.

- [ ] **Step 7: Commit**

```bash
git add shared/types/store-payments.ts worker/database/services/CatalogOrderService.ts worker/database/services/CatalogOrderService.test.ts worker/api/controllers/stores/controller.ts worker/api/routes/storeRoutes.ts worker/api/routes/index.ts worker/api/routes/store-routes-wiring.test.ts src/api-types.ts src/lib/api-client.ts
git commit -m "feat(store-payments): the seller's store orders with catalog tracking

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: The agent's store checkout skill

**Files:**
- Create: `worker/agents/think/skills/store-checkout/SKILL.md`
- Modify: `worker/agents/think/skills.ts`, `worker/agents/think/skills/app-file-structure/SKILL.md`
- Test: `worker/agents/think/store-checkout-skill.test.ts`

**Interfaces:**
- Consumes: the manifest schema (Task 1), the script (Task 9), the platform paths (Task 11).
- Produces: the `store-checkout` skill in the Think agent's catalog.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import SKILL from './skills/store-checkout/SKILL.md?raw';
import APP_FILE_STRUCTURE from './skills/app-file-structure/SKILL.md?raw';
import { parseStoreManifest } from '../../services/store-payments/manifest';

const skills = import.meta.glob<string>('/worker/agents/think/skills.ts', { query: '?raw', import: 'default', eager: true });

describe('the store checkout skill', () => {
	it('is registered with the agent', () => {
		expect(Object.values(skills)[0]).toContain("'store-checkout': STORE_CHECKOUT");
		expect(SKILL).toMatch(/^---\nname: store-checkout\ndescription: .+\n---/);
	});

	it('teaches a manifest Estori accepts', () => {
		const example = SKILL.match(/```json\n([\s\S]+?)\n```/)?.[1] ?? '';
		expect(parseStoreManifest(example).ok).toBe(true);
	});

	it('keeps payments on the platform', () => {
		for (const rule of ['/__estori/store.js', 'Estori.checkout(', 'Estori.order(', 'Never collect card details', 'catalogVariantId']) expect(SKILL).toContain(rule);
		expect(APP_FILE_STRUCTURE).toContain('store-checkout');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run worker/agents/think/store-checkout-skill.test.ts`
Expected: FAIL, the `SKILL.md?raw` import can't be resolved.

- [ ] **Step 3: Write the skill**

`worker/agents/think/skills/store-checkout/SKILL.md`:

````markdown
---
name: store-checkout
description: Products, prices, carts and checkout for stores. Load it before adding products, a cart, a checkout or an order confirmation page.
---

# Store checkout

Stores take payments through Estori. The store lists products and keeps a cart; Estori prices the cart, takes the
payment and records the order. Store code never handles money.

## 1. Products and prices live in `estori-store.json`

Create `estori-store.json` at the repository root. It is the only place prices exist: render products from it, and
never copy a price into code.

```json
{
  "version": 1,
  "currency": "usd",
  "shipping": { "countries": ["US"], "flatRateCents": 600, "freeOverCents": 7500 },
  "products": [
    {
      "id": "trail-mug",
      "name": "Trail Mug",
      "description": "Enamel camping mug.",
      "image": "/images/trail-mug.jpg",
      "variants": [
        { "id": "trail-mug-blue", "name": "Blue", "priceCents": 2400 },
        { "id": "trail-mug-red", "name": "Red", "priceCents": 2400, "available": false }
      ]
    }
  ]
}
```

Rules:

- Ids use lowercase letters, digits and dashes. Variant ids are unique across the file.
- `priceCents` is a whole number of cents from 50 to 1000000.
- `shipping.countries` lists two-letter country codes; `flatRateCents` is per order; shipping is free at or above
  `freeOverCents` when it is set.
- `image` is a path in the store (`/images/mug.jpg`) or an https address.
- No other fields: Estori refuses unknown fields.
- **Catalog products** carry `catalogVariantId` on their variant, and `priceCents` is the seller's retail price. Never
  write a catalog price or a supplier name anywhere in the store.

## 2. The store script

Every page that shows products, the cart or the confirmation loads:

```html
<script src="/__estori/store.js"></script>
```

It defines `window.Estori`:

- `Estori.store()` resolves with `{ mode, paymentsAvailable, currency, shipping, products }` from the deployed
  `estori-store.json`.
- `Estori.checkout({ items, shipTo, successPath, cancelPath, note })` starts a checkout and sends the shopper to pay. When
  it resolves with `{ ok: false, message }`, show `message`.
- `Estori.order(orderId)` resolves with the shopper's receipt.

## 3. Cart, checkout and confirmation

- Keep the cart as `[{ variantId, quantity }]` in `localStorage`, plus a ship-to country from `shipping.countries`.
- Show prices from `Estori.store()` (or by importing `estori-store.json` in server code).
- When `paymentsAvailable` is false, show "Checkout is unavailable right now" instead of the checkout button.

```js
async function startCheckout(cart, shipTo) {
  const result = await Estori.checkout({ items: cart, shipTo, successPath: '/thanks', cancelPath: '/cart' });
  if (!result.ok) document.querySelector('#checkout-error').textContent = result.message;
}

async function showConfirmation() {
  const orderId = new URLSearchParams(location.search).get('order');
  if (!orderId) return;
  const receipt = await Estori.order(orderId);
  document.querySelector('#order-number').textContent = `Order #${receipt.orderNumber}`;
  localStorage.removeItem('cart');
}
```

## 4. What store code must never do

- Never collect card details, build a payment form, call Stripe, or compute an amount to charge.
- Never define files or routes under `/__estori/`, and never create tables named `estori_*`.
- Never send prices, fees or accounts to `Estori.checkout`: it accepts only variant ids, quantities, the country, return
  paths and a note.

## 5. Test and live

In the preview, the store's owner pays with Stripe's test cards (4242 4242 4242 4242, any future date, any CVC). Anyone
else viewing the preview sees "This is a demo".
````

- [ ] **Step 4: Register it and point to it from the file-structure skill**

In `worker/agents/think/skills.ts`, add the import and the entry:

```ts
import STORE_CHECKOUT from './skills/store-checkout/SKILL.md?raw';
```

```ts
	'store-checkout': STORE_CHECKOUT,
```

Append to `worker/agents/think/skills/app-file-structure/SKILL.md`:

```markdown
## Reserved for the platform

Paths under `/__estori/`, tables named `estori_*` and the `live` branch belong to Estori. Stores that sell anything keep
products and prices in `estori-store.json` and take payments only as the `store-checkout` skill describes.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `rtk proxy npx vitest run worker/agents/think/store-checkout-skill.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add worker/agents/think/skills/store-checkout/SKILL.md worker/agents/think/skills.ts worker/agents/think/skills/app-file-structure/SKILL.md worker/agents/think/store-checkout-skill.test.ts
git commit -m "feat(agent): teach stores to take payments through estori

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Not in this plan (and where it goes)

- **Live stores** (a public origin per store, `store_versions`, `publishStoreVersion`, the reserved `live` branch): the Live stores spec, which the checkout spec names a prerequisite. Until it exists, payments run only in the owner's preview in Stripe test mode. Ruling: previews price from the deployed commit's manifest, recorded by SpaceDO at deploy time, as the spec says for previews.
- **The no-Stripe test page** (`/__estori/test-checkout/:id`): previews take Stripe test-mode payments instead, so the whole money path (fee, `on_behalf_of`, transfer, refund reversal) is exercised; with a live key, owner previews answer `payments_unavailable`. Ruling recorded in the ledger.
- **Own-product refunds and disputes, Express Dashboard refund recording** (`store_refunds`, `store_disputes`, `charge.*` events): after live stores, since test-mode previews carry no real disputes. Catalog refunds already exist (catalog plan Task 9).
- **The store's own order copy** (`estori_orders` in the App Facet, the SpaceDO outbox): the receipt endpoint covers confirmation pages; order history in generated stores waits for it.
- **Order emails, rate limits, the seller's Payments card, `chargesEnabled` in the status API, the confirmed-email gate:** with live stores, when shoppers other than the owner can pay.
- **`deploy_space` warnings and refusing `live`:** with live stores, which introduce the `live` branch.
- **Catalog prices:** `catalog-locks.ts` refuses catalog lines until the CJ plan replaces its body with `lockCatalogPrices` from the catalog tables.
