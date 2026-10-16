# Catalog Order Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The money and order core of the catalog: the application fee and price rules, catalog order records written once per paid checkout, supplier order placement with retries behind an adapter interface, supplier updates, and refunds split exactly between shopper, seller and Estori.

**Architecture:** Pure rules live in `shared/types/catalog.ts` (shared with the store builder) and `worker/services/catalog/`. Orchestrators take their dependencies as interfaces (`CatalogOrderStore`, `SupplierAdapter`, a slice of `StripeClient`), so every flow is tested with fakes. D1 holds the orders through `CatalogOrderService`. Two pieces wait for other specs: the scheduler that runs placement in the background (supplier connection spec; it needs a Durable Object binding in `wrangler.jsonc`, which only the owner commits) and wiring into Stripe's webhook (shopper checkout spec, which defines the paid checkout's cart).

**Tech Stack:** TypeScript, Cloudflare Workers, D1 with Drizzle (drizzle-kit migrations), Stripe REST over `fetch` (`worker/services/payments/stripe-client.ts`), Vitest with `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-10-15-catalog-order-payments-design.md`

## Global Constraints

- All money is integer US cents; currency `usd` only.
- The margin and the bring-your-own fee are provisional constants the owner confirms before launch: `CATALOG_MARGIN_PERCENT = 20`, `BYO_ORDER_FEE_CENTS = 50`.
- Processing cover is Stripe's standard US rate: `CATALOG_PROCESSING_PERCENT = 2.9`, `CATALOG_PROCESSING_FIXED_CENTS = 30`.
- Stripe requires the application fee to be below the payment.
- Estori never holds sellers' money; there is no wallet. AI credits are untouched.
- Cart field names follow the shopper checkout spec (`docs/superpowers/specs/2026-10-15-shopper-checkout-design.md`): catalog lines carry `lockedCatalogPriceCents`, and the cart carries `shipToCountry`. Checkout may ship first and create `shared/types/catalog.ts` with the processing constants and `applicationFeeCents` for own-product carts; if the file exists, Task 1 extends it instead of creating it, keeping what checkout added.
- The supplier contract in `worker/services/catalog/supplier.ts` is fixed: a background agent is designing the CJdropshipping adapter against exactly these shapes.
- `shared/types/catalog.ts` imports nothing: drizzle-kit loads the schema without path aliases.
- No `any`. Follow the file's existing indentation (tabs in `shared/` and `worker/services/`, four spaces in `worker/database/`).
- Never stage or commit `wrangler.jsonc`, `.dev.vars`, `bun.lockb` or anything under `.superpowers/`. Never push or deploy.
- Supplier names may appear in code and docs, never on the public site (`src/routes/copy-rules.ts`).
- Run tests with `rtk proxy npx vitest run <paths>`, a few files at a time (a whole-directory run exhausts local ports).
- Commit subjects are lowercase after the type prefix and end with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Stripe delivers the same paid Checkout session twice, or two deliveries race: exactly one catalog order exists (Task 4 tests the unique-violation path; Task 5 maps it to `already-recorded`).
2. A supplier rejects naming variants that aren't in the order, or naming none: every line sent in that call is rejected, never silently left pending (Task 6).
3. A supplier times out after it actually created the order: the next attempt sends the same `orderReference` (the catalog order id), so the adapter can return the existing order instead of placing a second one (Task 6 asserts the reference on every attempt).
4. A refund is requested twice for the same items (a retry or a double click): items already refunded are skipped and Stripe receives the same idempotency keys, so nobody is refunded twice (Task 9).
5. A cart with a zero total, a zero or fractional quantity, or a negative price reaches checkout: it is refused before any Stripe call (Task 1).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `shared/types/catalog.ts` (create) | Supplier ids, statuses, fee constants, cart types, catalog price, processing fee, minimum retail price, application fee, cart check |
| `shared/types/catalog.test.ts` (create) | Tests for the above |
| `worker/services/catalog/refunds.ts` (create) | `itemRefundSplit`: who pays for a refunded item |
| `worker/services/catalog/supplier.ts` (create) | The fixed supplier adapter contract |
| `worker/services/catalog/store.ts` (create) | `CatalogOrderStore` interface and its row types |
| `worker/services/catalog/record.ts` (create) | `recordPaidCatalogOrder`: a paid checkout becomes one catalog order |
| `worker/services/catalog/placement.ts` (create) | `placeCatalogOrder`, `nextRetryDelayMs`, `MAX_PLACEMENT_ATTEMPTS` |
| `worker/services/catalog/updates.ts` (create) | `applySupplierUpdate`: supplier reports become item patches |
| `worker/services/catalog/refund-items.ts` (create) | `refundCatalogItems`: Stripe refund and transfer reversal for items |
| `worker/services/catalog/*.test.ts` (create) | Tests with in-memory fakes |
| `worker/database/schema.ts` (modify) | `catalogOrders`, `catalogOrderItems` tables |
| `migrations/0016_catalog_orders.sql` (generated) | The tables, by drizzle-kit |
| `worker/database/catalog-schema.test.ts` (create) | Schema and migration checks |
| `worker/database/services/CatalogOrderService.ts` (create) | D1 implementation of `CatalogOrderStore` |
| `worker/database/services/CatalogOrderService.test.ts` (create) | SQL checks with `recordingD1` |
| `worker/database/index.ts` (modify) | Export `CatalogOrderService` |
| `worker/services/payments/stripe-client.ts` (modify) | `retrievePaymentIntent`, `createRefund`, `createTransferReversal` |
| `worker/services/payments/stripe-client.test.ts` (modify) | Request checks for the three methods |

---

### Task 1: Catalog money rules

**Files:**
- Create: `shared/types/catalog.ts`
- Test: `shared/types/catalog.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `CATALOG_SUPPLIERS`, `CatalogSupplier`, `CATALOG_ORDER_STATUSES`, `CatalogOrderStatus`, `CATALOG_ITEM_STATUSES`, `CatalogItemStatus`;
  - `CATALOG_MARGIN_PERCENT`, `CATALOG_PROCESSING_PERCENT`, `CATALOG_PROCESSING_FIXED_CENTS`, `BYO_ORDER_FEE_CENTS`;
  - `CartLine`, `CatalogCartLine`, `CheckoutCart`;
  - `catalogPriceCents(input: { supplierCostCents: number; shippingCents: number }): number`;
  - `processingFeeCents(amountCents: number): number`;
  - `minimumRetailPriceCents(catalogPrice: number): number`;
  - `cartTotalCents(cart: CheckoutCart): number`, `catalogTotalCents(cart: CheckoutCart): number`, `applicationFeeCents(cart: CheckoutCart): number`;
  - `checkCart(cart: CheckoutCart): CartCheck`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
	BYO_ORDER_FEE_CENTS,
	applicationFeeCents,
	catalogPriceCents,
	checkCart,
	minimumRetailPriceCents,
	processingFeeCents,
	type CatalogCartLine,
	type CheckoutCart,
} from './catalog';

const MUG: CatalogCartLine = {
	kind: 'catalog',
	catalogVariantId: 'cv_mug',
	supplier: 'cjdropshipping',
	supplierVariantId: 'cj_mug_white',
	lockedCatalogPriceCents: 1200,
	unitPriceCents: 2500,
	quantity: 2,
};

function cart(lines: CheckoutCart['lines'], shippingCents = 0): CheckoutCart {
	return { lines, shippingCents, shipToCountry: 'US' };
}

describe('catalog prices', () => {
	it('adds the margin to the supplier cost and shipping', () => {
		// (800 + 200) plus 20%.
		expect(catalogPriceCents({ supplierCostCents: 800, shippingCents: 200 })).toBe(1200);
	});

	it("covers Stripe's standard card rate, and nothing on a zero amount", () => {
		expect(processingFeeCents(10000)).toBe(320);
		expect(processingFeeCents(0)).toBe(0);
	});

	it('sets the lowest retail price whose remainder after processing still covers the catalog price', () => {
		const minimum = minimumRetailPriceCents(1200);
		expect(minimum).toBe(1267);
		expect(minimum - processingFeeCents(minimum)).toBeGreaterThanOrEqual(1200);
		expect(minimum - 1 - processingFeeCents(minimum - 1)).toBeLessThan(1200);
	});
});

describe('application fee', () => {
	it('takes the catalog price of each catalog unit plus processing on the whole payment', () => {
		const sample = cart([MUG, { kind: 'own', unitPriceCents: 1500, quantity: 1 }], 500);
		// Total 2 x 2500 + 1500 + 500 = 7000; catalog 2 x 1200; processing round(203) + 30.
		expect(applicationFeeCents(sample)).toBe(2400 + 233);
	});

	it('takes only processing when the cart has no catalog items', () => {
		expect(applicationFeeCents(cart([{ kind: 'own', unitPriceCents: 3000, quantity: 1 }]))).toBe(processingFeeCents(3000));
	});

	it('adds the bring-your-own fee once per order, however many such items it has', () => {
		const byo = { kind: 'byo', catalogVariantId: 'cv_tee', unitPriceCents: 2000, quantity: 3 } as const;
		expect(applicationFeeCents(cart([byo, { ...byo, catalogVariantId: 'cv_cap' }]))).toBe(BYO_ORDER_FEE_CENTS + processingFeeCents(12000));
	});
});

describe('checkCart', () => {
	it('accepts a valid cart and returns its total and fee', () => {
		expect(checkCart(cart([MUG], 500))).toEqual({ ok: true, totalCents: 5500, applicationFeeCents: applicationFeeCents(cart([MUG], 500)) });
	});

	it('refuses an empty cart, and one whose total is zero', () => {
		expect(checkCart(cart([]))).toEqual({ ok: false, problem: 'empty' });
		expect(checkCart(cart([{ kind: 'own', unitPriceCents: 0, quantity: 1 }]))).toEqual({ ok: false, problem: 'fee-exceeds-total' });
	});

	it('refuses zero or fractional quantities and negative or fractional amounts', () => {
		expect(checkCart(cart([{ ...MUG, quantity: 0 }]))).toEqual({ ok: false, problem: 'invalid-amount' });
		expect(checkCart(cart([{ ...MUG, quantity: 1.5 }]))).toEqual({ ok: false, problem: 'invalid-amount' });
		expect(checkCart(cart([{ ...MUG, unitPriceCents: -1 }]))).toEqual({ ok: false, problem: 'invalid-amount' });
		expect(checkCart(cart([MUG], 99.5))).toEqual({ ok: false, problem: 'invalid-amount' });
	});

	it('refuses a catalog item priced below its minimum retail price', () => {
		expect(checkCart(cart([{ ...MUG, unitPriceCents: 1266 }]))).toEqual({ ok: false, problem: 'below-minimum-price' });
		expect(checkCart(cart([{ ...MUG, unitPriceCents: 1267 }])).ok).toBe(true);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run shared/types/catalog.test.ts`
Expected: FAIL, "Failed to load url ./catalog".

- [ ] **Step 3: Write minimal implementation**

```ts
/** Catalog values shared by the database schema, the worker and the store builder. All amounts are US cents. */

export const CATALOG_SUPPLIERS = ['cjdropshipping'] as const;
export type CatalogSupplier = (typeof CATALOG_SUPPLIERS)[number];

/** A catalog order waits for placement, is done (each item placed or rejected), or needs the owner. */
export const CATALOG_ORDER_STATUSES = ['awaiting-placement', 'placement-done', 'needs-attention'] as const;
export type CatalogOrderStatus = (typeof CATALOG_ORDER_STATUSES)[number];

export const CATALOG_ITEM_STATUSES = ['pending', 'placed', 'rejected', 'shipped', 'delivered', 'refunded'] as const;
export type CatalogItemStatus = (typeof CATALOG_ITEM_STATUSES)[number];

/** Estori's margin, a percentage of supplier cost plus shipping. Provisional: the owner confirms it before launch. */
export const CATALOG_MARGIN_PERCENT = 20;

/** Stripe's standard US card rate. Estori pays it on destination charges, so its fee covers it. */
export const CATALOG_PROCESSING_PERCENT = 2.9;
export const CATALOG_PROCESSING_FIXED_CENTS = 30;

/** Estori's fee on an order with bring-your-own items, once per order. Provisional, like the margin. */
export const BYO_ORDER_FEE_CENTS = 50;

interface CartLineBase {
	/** The seller's retail price for one unit. */
	unitPriceCents: number;
	quantity: number;
}

export interface OwnCartLine extends CartLineBase {
	kind: 'own';
}

export interface CatalogCartLine extends CartLineBase {
	kind: 'catalog';
	catalogVariantId: string;
	supplier: CatalogSupplier;
	supplierVariantId: string;
	/** Locked when checkout starts, for the cart's ship-to country. */
	lockedCatalogPriceCents: number;
}

export interface ByoCartLine extends CartLineBase {
	kind: 'byo';
	catalogVariantId: string;
}

export type CartLine = OwnCartLine | CatalogCartLine | ByoCartLine;

export interface CheckoutCart {
	lines: readonly CartLine[];
	/** What the shopper pays the store for shipping. */
	shippingCents: number;
	/** ISO 3166-1 alpha-2; the catalog prices are locked for it. */
	shipToCountry: string;
}

export type CartProblem = 'empty' | 'invalid-amount' | 'below-minimum-price' | 'fee-exceeds-total';
export type CartCheck = { ok: true; totalCents: number; applicationFeeCents: number } | { ok: false; problem: CartProblem };

export function catalogPriceCents(input: { supplierCostCents: number; shippingCents: number }): number {
	const base = input.supplierCostCents + input.shippingCents;
	return base + Math.round((base * CATALOG_MARGIN_PERCENT) / 100);
}

export function processingFeeCents(amountCents: number): number {
	if (amountCents <= 0) return 0;
	return Math.round((amountCents * CATALOG_PROCESSING_PERCENT) / 100) + CATALOG_PROCESSING_FIXED_CENTS;
}

/** The lowest retail price whose remainder after the processing fee still covers the catalog price. */
export function minimumRetailPriceCents(catalogPrice: number): number {
	let price = Math.ceil((catalogPrice + CATALOG_PROCESSING_FIXED_CENTS) / (1 - CATALOG_PROCESSING_PERCENT / 100));
	while (price - processingFeeCents(price) < catalogPrice) price += 1;
	while (price > 1 && price - 1 - processingFeeCents(price - 1) >= catalogPrice) price -= 1;
	return price;
}

export function cartTotalCents(cart: CheckoutCart): number {
	return cart.lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0) + cart.shippingCents;
}

export function catalogTotalCents(cart: CheckoutCart): number {
	return cart.lines.reduce((sum, line) => (line.kind === 'catalog' ? sum + line.lockedCatalogPriceCents * line.quantity : sum), 0);
}

/** Estori's share of a store payment: catalog prices, the bring-your-own fee once, and processing on the whole payment. */
export function applicationFeeCents(cart: CheckoutCart): number {
	const byoFee = cart.lines.some((line) => line.kind === 'byo') ? BYO_ORDER_FEE_CENTS : 0;
	return catalogTotalCents(cart) + byoFee + processingFeeCents(cartTotalCents(cart));
}

function isCount(value: number): boolean {
	return Number.isInteger(value) && value >= 0;
}

/** Whether a cart can be paid: valid amounts, catalog prices at or above their minimum, and a fee below the total. */
export function checkCart(cart: CheckoutCart): CartCheck {
	if (cart.lines.length === 0) return { ok: false, problem: 'empty' };
	const amounts = [cart.shippingCents, ...cart.lines.flatMap((line) => [line.unitPriceCents, ...(line.kind === 'catalog' ? [line.lockedCatalogPriceCents] : [])])];
	const invalid = !amounts.every(isCount) || cart.lines.some((line) => !Number.isInteger(line.quantity) || line.quantity < 1);
	if (invalid) return { ok: false, problem: 'invalid-amount' };
	if (cart.lines.some((line) => line.kind === 'catalog' && line.unitPriceCents < minimumRetailPriceCents(line.lockedCatalogPriceCents))) {
		return { ok: false, problem: 'below-minimum-price' };
	}
	const totalCents = cartTotalCents(cart);
	const fee = applicationFeeCents(cart);
	// Stripe requires the application fee to be below the payment.
	if (fee >= totalCents) return { ok: false, problem: 'fee-exceeds-total' };
	return { ok: true, totalCents, applicationFeeCents: fee };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy npx vitest run shared/types/catalog.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add shared/types/catalog.ts shared/types/catalog.test.ts
git commit -m "feat(catalog): catalog prices, the application fee and the cart check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Who pays for a refunded item

**Files:**
- Create: `worker/services/catalog/refunds.ts`
- Test: `worker/services/catalog/refunds.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `RefundReason = 'supplier-rejected' | 'seller-refund'`;
  - `ItemRefundSplit = { shopperCents: number; sellerCents: number; estoriCents: number }`;
  - `itemRefundSplit(input: { reason: RefundReason; retailCents: number; catalogCents: number; supplierRefunded: boolean }): ItemRefundSplit`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { itemRefundSplit } from './refunds';

describe('itemRefundSplit', () => {
	it("returns the catalog price from Estori when the supplier rejected the item, and the rest from the seller's share", () => {
		expect(itemRefundSplit({ reason: 'supplier-rejected', retailCents: 5000, catalogCents: 2400, supplierRefunded: false })).toEqual({
			shopperCents: 5000,
			sellerCents: 2600,
			estoriCents: 2400,
		});
	});

	it('returns the catalog price from Estori on a seller refund only when the supplier refunded Estori', () => {
		expect(itemRefundSplit({ reason: 'seller-refund', retailCents: 5000, catalogCents: 2400, supplierRefunded: true })).toEqual({
			shopperCents: 5000,
			sellerCents: 2600,
			estoriCents: 2400,
		});
		expect(itemRefundSplit({ reason: 'seller-refund', retailCents: 5000, catalogCents: 2400, supplierRefunded: false })).toEqual({
			shopperCents: 5000,
			sellerCents: 5000,
			estoriCents: 0,
		});
	});

	it('always splits the refund exactly between seller and Estori', () => {
		for (const supplierRefunded of [true, false]) {
			for (const reason of ['supplier-rejected', 'seller-refund'] as const) {
				const split = itemRefundSplit({ reason, retailCents: 3333, catalogCents: 1111, supplierRefunded });
				expect(split.sellerCents + split.estoriCents).toBe(split.shopperCents);
			}
		}
	});

	it('refuses amounts the cart check never allows', () => {
		expect(() => itemRefundSplit({ reason: 'seller-refund', retailCents: 1000, catalogCents: 1200, supplierRefunded: true })).toThrow(RangeError);
		expect(() => itemRefundSplit({ reason: 'seller-refund', retailCents: -1, catalogCents: 0, supplierRefunded: false })).toThrow(RangeError);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run worker/services/catalog/refunds.test.ts`
Expected: FAIL, "Failed to load url ./refunds".

- [ ] **Step 3: Write minimal implementation**

```ts
/** Who pays for a refunded catalog item. Stripe keeps its processing fee on refunds, so Estori absorbs that part. */

export type RefundReason = 'supplier-rejected' | 'seller-refund';

export interface ItemRefundSplit {
	/** Refunded to the shopper. */
	shopperCents: number;
	/** Taken back from the seller's transfer. */
	sellerCents: number;
	/** Paid by Estori: the catalog price, returned when the supplier never kept it. */
	estoriCents: number;
}

/**
 * A rejected item never reached the supplier, and a supplier refund gives Estori its money back: in both cases Estori
 * returns the catalog price. Otherwise the goods were bought and shipped, so the seller bears the whole refund.
 */
export function itemRefundSplit(input: { reason: RefundReason; retailCents: number; catalogCents: number; supplierRefunded: boolean }): ItemRefundSplit {
	const { retailCents, catalogCents } = input;
	if (!Number.isInteger(retailCents) || !Number.isInteger(catalogCents) || catalogCents < 0 || retailCents < catalogCents) {
		throw new RangeError('A refund needs whole cents, with the catalog price at or below the retail price');
	}
	const estoriCents = input.reason === 'supplier-rejected' || input.supplierRefunded ? catalogCents : 0;
	return { shopperCents: retailCents, sellerCents: retailCents - estoriCents, estoriCents };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy npx vitest run worker/services/catalog/refunds.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/services/catalog/refunds.ts worker/services/catalog/refunds.test.ts
git commit -m "feat(catalog): split each refunded item between seller and estori

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Catalog order tables and migration

**Files:**
- Modify: `worker/database/schema.ts` (import line at the top; tables after `stripeConnectAccounts`)
- Generated: `migrations/0016_catalog_orders.sql`, `migrations/meta/0016_snapshot.json`, `migrations/meta/_journal.json`
- Test: `worker/database/catalog-schema.test.ts`

**Interfaces:**
- Consumes: `CATALOG_SUPPLIERS`, `CATALOG_ORDER_STATUSES`, `CATALOG_ITEM_STATUSES` from Task 1.
- Produces: `schema.catalogOrders`, `schema.catalogOrderItems`, index `catalog_orders_checkout_session_unique_idx`.

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

describe('catalog order schema', () => {
	it('records each paid Checkout session as at most one catalog order', () => {
		expect(indexNamed(schema.catalogOrders, 'catalog_orders_checkout_session_unique_idx')?.config.unique).toBe(true);
		expect(schema.catalogOrders.stripeCheckoutSessionId.notNull).toBe(true);
	});

	it('starts orders awaiting placement and items pending, in dollars', () => {
		expect(schema.catalogOrders.status.default).toBe('awaiting-placement');
		expect(schema.catalogOrders.status.enumValues).toEqual(['awaiting-placement', 'placement-done', 'needs-attention']);
		expect(schema.catalogOrders.currency.default).toBe('usd');
		expect(schema.catalogOrderItems.status.default).toBe('pending');
		expect(schema.catalogOrderItems.supplier.enumValues).toEqual(['cjdropshipping']);
		expect(schema.catalogOrderItems.supplierRefunded.default).toBe(false);
	});

	it('ships both tables and the unique session index in a migration', () => {
		expect(allMigrationSql).toContain('CREATE TABLE `catalog_orders`');
		expect(allMigrationSql).toContain('CREATE TABLE `catalog_order_items`');
		expect(allMigrationSql).toContain('CREATE UNIQUE INDEX `catalog_orders_checkout_session_unique_idx`');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run worker/database/catalog-schema.test.ts`
Expected: FAIL, `schema.catalogOrders` is undefined.

- [ ] **Step 3: Add the tables**

Add this import below the existing `../../shared/types/templates` import in `worker/database/schema.ts`:

```ts
import { CATALOG_ITEM_STATUSES, CATALOG_ORDER_STATUSES, CATALOG_SUPPLIERS } from '../../shared/types/catalog';
```

Add after the `stripeConnectAccounts` table:

```ts
/**
 * Catalog orders - the catalog part of a paid store checkout. Estori buys these items from suppliers with the
 * application fee it took from the payment; one order per Checkout session.
 */
export const catalogOrders = sqliteTable('catalog_orders', {
    id: text('id').primaryKey(),
    sellerUserId: text('seller_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    storeAppId: text('store_app_id').notNull(),
    stripeCheckoutSessionId: text('stripe_checkout_session_id').notNull(),
    stripePaymentIntentId: text('stripe_payment_intent_id').notNull(),
    status: text('status', { enum: CATALOG_ORDER_STATUSES }).notNull().default('awaiting-placement'),
    totalCents: integer('total_cents').notNull(),
    catalogTotalCents: integer('catalog_total_cents').notNull(),
    applicationFeeCents: integer('application_fee_cents').notNull(),
    currency: text('currency').notNull().default('usd'),
    destinationCountry: text('destination_country').notNull(),
    // The shopper's address as JSON: supplier orders are placed after the webhook answers.
    shippingAddress: text('shipping_address').notNull(),
    placementAttempts: integer('placement_attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    checkoutSessionIdx: uniqueIndex('catalog_orders_checkout_session_unique_idx').on(table.stripeCheckoutSessionId),
    sellerIdx: index('catalog_orders_seller_idx').on(table.sellerUserId),
    statusIdx: index('catalog_orders_status_idx').on(table.status),
}));

/** Catalog order items - one per catalog line, with the price locked at checkout and the supplier's progress. */
export const catalogOrderItems = sqliteTable('catalog_order_items', {
    id: text('id').primaryKey(),
    orderId: text('order_id').notNull().references(() => catalogOrders.id, { onDelete: 'cascade' }),
    catalogVariantId: text('catalog_variant_id').notNull(),
    supplier: text('supplier', { enum: CATALOG_SUPPLIERS }).notNull(),
    supplierVariantId: text('supplier_variant_id').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    catalogPriceCents: integer('catalog_price_cents').notNull(),
    status: text('status', { enum: CATALOG_ITEM_STATUSES }).notNull().default('pending'),
    supplierOrderId: text('supplier_order_id'),
    trackingNumber: text('tracking_number'),
    carrier: text('carrier'),
    supplierRefunded: integer('supplier_refunded', { mode: 'boolean' }).notNull().default(false),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    orderIdx: index('catalog_order_items_order_idx').on(table.orderId),
    supplierOrderIdx: index('catalog_order_items_supplier_order_idx').on(table.supplierOrderId),
}));
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate -- --name catalog_orders`
Expected: drizzle-kit writes `migrations/0016_catalog_orders.sql` with `CREATE TABLE \`catalog_orders\``, `CREATE TABLE \`catalog_order_items\``, the four indexes and the unique session index, and updates `migrations/meta`. Open the SQL and confirm it touches no other table.

- [ ] **Step 5: Apply it to the local database**

Run: `CI=true npm run db:migrate:local`
Expected: `0016_catalog_orders.sql` applied with no error, which also proves the SQL is valid SQLite. `CI=true` skips wrangler's confirmation prompt; the command reads `wrangler.jsonc` without changing it.

- [ ] **Step 6: Run test to verify it passes**

Run: `rtk proxy npx vitest run worker/database/catalog-schema.test.ts worker/database/payments-schema.test.ts`
Expected: PASS, both files.

- [ ] **Step 7: Commit**

```bash
git add worker/database/schema.ts worker/database/catalog-schema.test.ts migrations/0016_catalog_orders.sql migrations/meta/0016_snapshot.json migrations/meta/_journal.json
git commit -m "feat(catalog): catalog order and item tables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The catalog order store and its D1 service

**Files:**
- Create: `worker/services/catalog/supplier.ts` (types needed by the store)
- Create: `worker/services/catalog/store.ts`
- Create: `worker/database/services/CatalogOrderService.ts`
- Modify: `worker/database/index.ts` (export after `StripeConnectService`)
- Test: `worker/database/services/CatalogOrderService.test.ts`

**Interfaces:**
- Consumes: Task 1 types; Task 3 tables.
- Produces:
  - `supplier.ts`: the fixed contract (`CATALOG_SUPPLIERS`, `CatalogSupplier` re-exported, `ShippingAddress`, `SupplierOrderLine`, `PlaceOrderResult`, `SupplierAdapter`, `SupplierUpdate`);
  - `store.ts`: `NewCatalogOrder`, `NewCatalogOrderItem`, `CatalogOrderRow`, `CatalogOrderItemRow`, `ItemPatch`, `CatalogOrderStore`;
  - `CatalogOrderService implements CatalogOrderStore`.

- [ ] **Step 1: Write the contract and store types**

`worker/services/catalog/supplier.ts`, exactly as given to the adapter design:

```ts
/** What Estori needs from a catalog supplier. The CJdropshipping adapter implements it (see its spec). */

export { CATALOG_SUPPLIERS, type CatalogSupplier } from '../../../shared/types/catalog';
import type { CatalogSupplier } from '../../../shared/types/catalog';

export interface ShippingAddress {
	name: string;
	line1: string;
	line2: string | null;
	city: string;
	region: string | null;
	postalCode: string;
	/** ISO 3166-1 alpha-2, e.g. "US". */
	countryCode: string;
	phone: string | null;
	email: string | null;
}

export interface SupplierOrderLine {
	supplierVariantId: string;
	quantity: number;
}

/** 'rejected' is permanent (out of stock, unknown variant, undeliverable); 'retryable' is temporary (network, rate limit, supplier error). */
export type PlaceOrderResult =
	| { ok: true; supplierOrderId: string }
	| { ok: false; kind: 'rejected'; reason: string; rejectedVariantIds: readonly string[] }
	| { ok: false; kind: 'retryable'; reason: string };

export interface SupplierAdapter {
	readonly supplier: CatalogSupplier;
	/** `orderReference` is Estori's catalog order id; the adapter must make a repeated call with the same reference place at most one supplier order. */
	placeOrder(input: { orderReference: string; lines: readonly SupplierOrderLine[]; address: ShippingAddress }): Promise<PlaceOrderResult>;
}

/** What the supplier reports back, from webhooks or polling. */
export type SupplierUpdate =
	| { kind: 'shipped'; supplierOrderId: string; trackingNumber: string; carrier: string }
	| { kind: 'delivered'; supplierOrderId: string }
	| { kind: 'refunded'; supplierOrderId: string; supplierVariantIds: readonly string[] };
```

`worker/services/catalog/store.ts`:

```ts
/** How catalog flows read and write orders; CatalogOrderService implements it on D1, tests use an in-memory fake. */

import type { CatalogItemStatus, CatalogOrderStatus, CatalogSupplier } from '../../../shared/types/catalog';
import type { ShippingAddress } from './supplier';

export interface NewCatalogOrderItem {
	id: string;
	catalogVariantId: string;
	supplier: CatalogSupplier;
	supplierVariantId: string;
	quantity: number;
	unitPriceCents: number;
	catalogPriceCents: number;
}

export interface NewCatalogOrder {
	id: string;
	sellerUserId: string;
	storeAppId: string;
	checkoutSessionId: string;
	paymentIntentId: string;
	totalCents: number;
	catalogTotalCents: number;
	applicationFeeCents: number;
	destinationCountry: string;
	shippingAddress: ShippingAddress;
	items: readonly NewCatalogOrderItem[];
	createdAt: Date;
}

export interface CatalogOrderItemRow {
	id: string;
	catalogVariantId: string;
	supplier: CatalogSupplier;
	supplierVariantId: string;
	quantity: number;
	unitPriceCents: number;
	catalogPriceCents: number;
	status: CatalogItemStatus;
	supplierOrderId: string | null;
	supplierRefunded: boolean;
}

export interface CatalogOrderRow {
	id: string;
	status: CatalogOrderStatus;
	paymentIntentId: string;
	placementAttempts: number;
	shippingAddress: ShippingAddress;
	items: readonly CatalogOrderItemRow[];
}

export interface ItemPatch {
	itemId: string;
	status?: CatalogItemStatus;
	supplierOrderId?: string;
	trackingNumber?: string;
	carrier?: string;
	supplierRefunded?: boolean;
}

export interface CatalogOrderStore {
	/** Writes the order and its items together; false when this Checkout session already has an order. */
	insertPaidOrder(order: NewCatalogOrder): Promise<boolean>;
	getOrder(orderId: string): Promise<CatalogOrderRow | null>;
	patchItems(patches: readonly ItemPatch[]): Promise<void>;
	updateOrder(orderId: string, update: { status: CatalogOrderStatus; placementAttempts: number; lastError: string | null }): Promise<void>;
}
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { CatalogOrderService } from './CatalogOrderService';
import { recordingD1 } from '../test-support/recording-d1';
import type { NewCatalogOrder } from '../../services/catalog/store';

const ORDER: NewCatalogOrder = {
	id: 'co_1',
	sellerUserId: 'u1',
	storeAppId: 'app_1',
	checkoutSessionId: 'cs_1',
	paymentIntentId: 'pi_1',
	totalCents: 5500,
	catalogTotalCents: 2400,
	applicationFeeCents: 2590,
	destinationCountry: 'US',
	shippingAddress: { name: 'Ada', line1: '1 Main St', line2: null, city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US', phone: null, email: null },
	items: [{ id: 'ci_1', catalogVariantId: 'cv_mug', supplier: 'cjdropshipping', supplierVariantId: 'cj_mug', quantity: 2, unitPriceCents: 2500, catalogPriceCents: 1200 }],
	createdAt: new Date(1_800_000_000_000),
};

describe('CatalogOrderService', () => {
	it('writes the order and its items in one batch', async () => {
		const { d1, batches } = recordingD1();
		const orders = new CatalogOrderService({ DB: d1 } as unknown as Env);

		expect(await orders.insertPaidOrder(ORDER)).toBe(true);
		expect(batches).toHaveLength(1);
		expect(batches[0].map((entry) => entry.sql.split(' (')[0].toLowerCase())).toEqual([
			'insert into "catalog_orders"',
			'insert into "catalog_order_items"',
		]);
		expect(batches[0][0].params).toContain('cs_1');
		expect(batches[0][0].params).toContain(JSON.stringify(ORDER.shippingAddress));
	});

	it('answers false when the Checkout session already has an order', async () => {
		const { d1 } = recordingD1();
		const duplicate = { ...d1, batch: async () => Promise.reject(new Error('D1_ERROR: UNIQUE constraint failed: catalog_orders.stripe_checkout_session_id: SQLITE_CONSTRAINT')) };
		const orders = new CatalogOrderService({ DB: duplicate } as unknown as Env);

		expect(await orders.insertPaidOrder(ORDER)).toBe(false);
	});

	it('rethrows any other failure', async () => {
		const { d1 } = recordingD1();
		const broken = { ...d1, batch: async () => Promise.reject(new Error('Network connection lost')) };
		const orders = new CatalogOrderService({ DB: broken } as unknown as Env);

		await expect(orders.insertPaidOrder(ORDER)).rejects.toThrow('Network connection lost');
	});

	it('patches only the fields each patch names', async () => {
		const { d1, batches } = recordingD1();
		const orders = new CatalogOrderService({ DB: d1 } as unknown as Env);

		await orders.patchItems([
			{ itemId: 'ci_1', status: 'placed', supplierOrderId: 'cj_order_9' },
			{ itemId: 'ci_2', supplierRefunded: true },
		]);
		expect(batches[0]).toHaveLength(2);
		expect(batches[0][0].sql.toLowerCase()).toMatch(/update "catalog_order_items" set "status" = \?, "supplier_order_id" = \?, "updated_at" = \?/);
		expect(batches[0][1].sql.toLowerCase()).toMatch(/update "catalog_order_items" set "supplier_refunded" = \?, "updated_at" = \?/);
	});

	it('makes no call for an empty list of patches', async () => {
		const { d1, batches, statements } = recordingD1();
		await new CatalogOrderService({ DB: d1 } as unknown as Env).patchItems([]);
		expect(batches).toHaveLength(0);
		expect(statements).toHaveLength(0);
	});

	it('reads an order with its items and parses the address', async () => {
		const orderRow = ['co_1', 'awaiting-placement', 'pi_1', 0, JSON.stringify(ORDER.shippingAddress)];
		const itemRow = ['ci_1', 'cv_mug', 'cjdropshipping', 'cj_mug', 2, 2500, 1200, 'pending', null, 0];
		const { d1 } = recordingD1((sql) => (sql.includes('from "catalog_order_items"') ? [itemRow] : [orderRow]));
		const order = await new CatalogOrderService({ DB: d1 } as unknown as Env).getOrder('co_1');

		expect(order).toEqual({
			id: 'co_1',
			status: 'awaiting-placement',
			paymentIntentId: 'pi_1',
			placementAttempts: 0,
			shippingAddress: ORDER.shippingAddress,
			items: [
				{
					id: 'ci_1',
					catalogVariantId: 'cv_mug',
					supplier: 'cjdropshipping',
					supplierVariantId: 'cj_mug',
					quantity: 2,
					unitPriceCents: 2500,
					catalogPriceCents: 1200,
					status: 'pending',
					supplierOrderId: null,
					supplierRefunded: false,
				},
			],
		});
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `rtk proxy npx vitest run worker/database/services/CatalogOrderService.test.ts`
Expected: FAIL, "Failed to load url ./CatalogOrderService".

- [ ] **Step 4: Write the service**

```ts
/** D1 reads and writes for catalog orders and their items. */

import { eq } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import type { CatalogOrderRow, CatalogOrderStore, ItemPatch, NewCatalogOrder } from '../../services/catalog/store';
import type { ShippingAddress } from '../../services/catalog/supplier';
import type { CatalogOrderStatus } from '../../../shared/types/catalog';

function isUniqueViolation(error: unknown): boolean {
    return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

export class CatalogOrderService extends BaseService implements CatalogOrderStore {
    async insertPaidOrder(order: NewCatalogOrder): Promise<boolean> {
        const at = order.createdAt;
        try {
            await this.database.batch([
                this.database.insert(schema.catalogOrders).values({
                    id: order.id,
                    sellerUserId: order.sellerUserId,
                    storeAppId: order.storeAppId,
                    stripeCheckoutSessionId: order.checkoutSessionId,
                    stripePaymentIntentId: order.paymentIntentId,
                    totalCents: order.totalCents,
                    catalogTotalCents: order.catalogTotalCents,
                    applicationFeeCents: order.applicationFeeCents,
                    destinationCountry: order.destinationCountry,
                    shippingAddress: JSON.stringify(order.shippingAddress),
                    createdAt: at,
                    updatedAt: at,
                }),
                this.database.insert(schema.catalogOrderItems).values(order.items.map((item) => ({ ...item, orderId: order.id, updatedAt: at }))),
            ]);
            return true;
        } catch (error) {
            // The unique session index refuses a second order for the same payment; the batch writes nothing.
            if (isUniqueViolation(error)) return false;
            throw error;
        }
    }

    async getOrder(orderId: string): Promise<CatalogOrderRow | null> {
        const order = await this.database
            .select({
                id: schema.catalogOrders.id,
                status: schema.catalogOrders.status,
                paymentIntentId: schema.catalogOrders.stripePaymentIntentId,
                placementAttempts: schema.catalogOrders.placementAttempts,
                shippingAddress: schema.catalogOrders.shippingAddress,
            })
            .from(schema.catalogOrders)
            .where(eq(schema.catalogOrders.id, orderId))
            .get();
        if (!order) return null;
        const items = await this.database
            .select({
                id: schema.catalogOrderItems.id,
                catalogVariantId: schema.catalogOrderItems.catalogVariantId,
                supplier: schema.catalogOrderItems.supplier,
                supplierVariantId: schema.catalogOrderItems.supplierVariantId,
                quantity: schema.catalogOrderItems.quantity,
                unitPriceCents: schema.catalogOrderItems.unitPriceCents,
                catalogPriceCents: schema.catalogOrderItems.catalogPriceCents,
                status: schema.catalogOrderItems.status,
                supplierOrderId: schema.catalogOrderItems.supplierOrderId,
                supplierRefunded: schema.catalogOrderItems.supplierRefunded,
            })
            .from(schema.catalogOrderItems)
            .where(eq(schema.catalogOrderItems.orderId, orderId))
            .all();
        const shippingAddress: ShippingAddress = JSON.parse(order.shippingAddress);
        return { ...order, shippingAddress, items };
    }

    async patchItems(patches: readonly ItemPatch[]): Promise<void> {
        const now = new Date();
        const [first, ...rest] = patches.map(({ itemId, ...fields }) =>
            this.database.update(schema.catalogOrderItems).set({ ...fields, updatedAt: now }).where(eq(schema.catalogOrderItems.id, itemId)),
        );
        // Drizzle's batch takes a non-empty list, and an empty list of patches has nothing to write.
        if (!first) return;
        await this.database.batch([first, ...rest]);
    }

    async updateOrder(orderId: string, update: { status: CatalogOrderStatus; placementAttempts: number; lastError: string | null }): Promise<void> {
        await this.database
            .update(schema.catalogOrders)
            .set({ ...update, updatedAt: new Date() })
            .where(eq(schema.catalogOrders.id, orderId));
    }
}
```

Add to `worker/database/index.ts` after the `StripeConnectService` export:

```ts
export { CatalogOrderService } from './services/CatalogOrderService';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `rtk proxy npx vitest run worker/database/services/CatalogOrderService.test.ts`
Expected: PASS, 6 tests. If the `getOrder` mapping differs from the rows `recordingD1` returns, fix the selected column order in the service, not the test's expectation.

- [ ] **Step 6: Commit**

```bash
git add worker/services/catalog/supplier.ts worker/services/catalog/store.ts worker/database/services/CatalogOrderService.ts worker/database/services/CatalogOrderService.test.ts worker/database/index.ts
git commit -m "feat(catalog): the supplier contract and the catalog order store on d1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Record a paid checkout as one catalog order

**Files:**
- Create: `worker/services/catalog/record.ts`
- Create: `worker/services/catalog/test-support.ts` (the in-memory store fake, reused by Tasks 6 and 9)
- Test: `worker/services/catalog/record.test.ts`

**Interfaces:**
- Consumes: Task 1 (`CheckoutCart`, `cartTotalCents`, `catalogTotalCents`, `applicationFeeCents`), Task 4 (`CatalogOrderStore`, `NewCatalogOrder`, `ShippingAddress`).
- Produces:
  - `PaidCatalogCheckout = { checkoutSessionId: string; paymentIntentId: string; sellerUserId: string; storeAppId: string; cart: CheckoutCart; shippingAddress: ShippingAddress }`;
  - `recordPaidCatalogOrder(deps: { store: CatalogOrderStore; newId: () => string; now: () => Date }, paid: PaidCatalogCheckout): Promise<{ result: 'recorded' | 'already-recorded' | 'no-catalog-items'; orderId: string | null }>`;
  - `memoryCatalogStore(): CatalogOrderStore & { orders: Map<string, CatalogOrderRow & { lastError: string | null }> }`.

- [ ] **Step 1: Write the in-memory store fake**

`worker/services/catalog/test-support.ts`:

```ts
/** An in-memory CatalogOrderStore for tests, honoring the one-order-per-session rule. */

import type { CatalogOrderRow, CatalogOrderStore } from './store';

export function memoryCatalogStore(): CatalogOrderStore & { orders: Map<string, CatalogOrderRow & { lastError: string | null }> } {
	const orders = new Map<string, CatalogOrderRow & { lastError: string | null }>();
	const sessions = new Set<string>();
	return {
		orders,
		async insertPaidOrder(order) {
			if (sessions.has(order.checkoutSessionId)) return false;
			sessions.add(order.checkoutSessionId);
			orders.set(order.id, {
				id: order.id,
				status: 'awaiting-placement',
				paymentIntentId: order.paymentIntentId,
				placementAttempts: 0,
				shippingAddress: order.shippingAddress,
				lastError: null,
				items: order.items.map((item) => ({ ...item, status: 'pending', supplierOrderId: null, supplierRefunded: false })),
			});
			return true;
		},
		async getOrder(orderId) {
			return orders.get(orderId) ?? null;
		},
		async patchItems(patches) {
			for (const order of orders.values()) {
				order.items = order.items.map((item) => {
					const patch = patches.find((candidate) => candidate.itemId === item.id);
					if (!patch) return item;
					const { itemId: _itemId, trackingNumber: _tracking, carrier: _carrier, ...fields } = patch;
					return { ...item, ...fields };
				});
			}
		},
		async updateOrder(orderId, update) {
			const order = orders.get(orderId);
			if (order) orders.set(orderId, { ...order, ...update });
		},
	};
}
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { recordPaidCatalogOrder, type PaidCatalogCheckout } from './record';
import { memoryCatalogStore } from './test-support';

const ADDRESS = { name: 'Ada', line1: '1 Main St', line2: null, city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US', phone: null, email: null };

const PAID: PaidCatalogCheckout = {
	checkoutSessionId: 'cs_1',
	paymentIntentId: 'pi_1',
	sellerUserId: 'u1',
	storeAppId: 'app_1',
	shippingAddress: ADDRESS,
	cart: {
		shipToCountry: 'US',
		shippingCents: 500,
		lines: [
			{ kind: 'catalog', catalogVariantId: 'cv_mug', supplier: 'cjdropshipping', supplierVariantId: 'cj_mug', lockedCatalogPriceCents: 1200, unitPriceCents: 2500, quantity: 2 },
			{ kind: 'own', unitPriceCents: 1500, quantity: 1 },
		],
	},
};

function deps(store = memoryCatalogStore()) {
	let next = 0;
	return { store, newId: () => `id_${(next += 1)}`, now: () => new Date(1_800_000_000_000) };
}

describe('recordPaidCatalogOrder', () => {
	it('records the catalog lines of a paid checkout, with the fee and the locked prices', async () => {
		const store = memoryCatalogStore();
		const outcome = await recordPaidCatalogOrder(deps(store), PAID);

		expect(outcome).toEqual({ result: 'recorded', orderId: 'id_1' });
		const order = store.orders.get('id_1');
		expect(order?.items).toEqual([
			expect.objectContaining({ id: 'id_2', supplierVariantId: 'cj_mug', quantity: 2, catalogPriceCents: 1200, unitPriceCents: 2500, status: 'pending' }),
		]);
	});

	it('records a redelivered session only once', async () => {
		const store = memoryCatalogStore();
		await recordPaidCatalogOrder(deps(store), PAID);
		const again = await recordPaidCatalogOrder(deps(store), PAID);

		expect(again).toEqual({ result: 'already-recorded', orderId: null });
		expect(store.orders.size).toBe(1);
	});

	it('records nothing for a cart without catalog items', async () => {
		const store = memoryCatalogStore();
		const ownOnly = { ...PAID, cart: { ...PAID.cart, lines: [{ kind: 'own', unitPriceCents: 1500, quantity: 1 }] as const } };

		expect(await recordPaidCatalogOrder(deps(store), ownOnly)).toEqual({ result: 'no-catalog-items', orderId: null });
		expect(store.orders.size).toBe(0);
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `rtk proxy npx vitest run worker/services/catalog/record.test.ts`
Expected: FAIL, "Failed to load url ./record".

- [ ] **Step 4: Write the orchestrator**

```ts
/** A paid store checkout becomes one catalog order: its catalog lines, prices locked, the fee Estori took. */

import { applicationFeeCents, cartTotalCents, catalogTotalCents, type CatalogCartLine, type CheckoutCart } from '../../../shared/types/catalog';
import type { CatalogOrderStore } from './store';
import type { ShippingAddress } from './supplier';

export interface PaidCatalogCheckout {
	checkoutSessionId: string;
	paymentIntentId: string;
	sellerUserId: string;
	storeAppId: string;
	cart: CheckoutCart;
	shippingAddress: ShippingAddress;
}

export interface RecordDeps {
	store: CatalogOrderStore;
	newId: () => string;
	now: () => Date;
}

export type RecordResult = 'recorded' | 'already-recorded' | 'no-catalog-items';

/** Bring-your-own lines are the seller's to order, so only catalog lines become items. */
export async function recordPaidCatalogOrder(deps: RecordDeps, paid: PaidCatalogCheckout): Promise<{ result: RecordResult; orderId: string | null }> {
	const catalogLines = paid.cart.lines.filter((line): line is CatalogCartLine => line.kind === 'catalog');
	if (catalogLines.length === 0) return { result: 'no-catalog-items', orderId: null };
	const orderId = deps.newId();
	const recorded = await deps.store.insertPaidOrder({
		id: orderId,
		sellerUserId: paid.sellerUserId,
		storeAppId: paid.storeAppId,
		checkoutSessionId: paid.checkoutSessionId,
		paymentIntentId: paid.paymentIntentId,
		totalCents: cartTotalCents(paid.cart),
		catalogTotalCents: catalogTotalCents(paid.cart),
		applicationFeeCents: applicationFeeCents(paid.cart),
		destinationCountry: paid.cart.shipToCountry,
		shippingAddress: paid.shippingAddress,
		items: catalogLines.map((line) => ({
			id: deps.newId(),
			catalogVariantId: line.catalogVariantId,
			supplier: line.supplier,
			supplierVariantId: line.supplierVariantId,
			quantity: line.quantity,
			unitPriceCents: line.unitPriceCents,
			catalogPriceCents: line.lockedCatalogPriceCents,
		})),
		createdAt: deps.now(),
	});
	return recorded ? { result: 'recorded', orderId } : { result: 'already-recorded', orderId: null };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `rtk proxy npx vitest run worker/services/catalog/record.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add worker/services/catalog/record.ts worker/services/catalog/record.test.ts worker/services/catalog/test-support.ts
git commit -m "feat(catalog): record a paid checkout's catalog lines once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Place supplier orders, with retries

**Files:**
- Create: `worker/services/catalog/placement.ts`
- Test: `worker/services/catalog/placement.test.ts`

**Interfaces:**
- Consumes: Task 4 (`CatalogOrderStore`, `SupplierAdapter`, `CATALOG_SUPPLIERS`), Task 5 (`memoryCatalogStore`).
- Produces:
  - `MAX_PLACEMENT_ATTEMPTS = 6`;
  - `nextRetryDelayMs(failedAttempts: number): number`;
  - `PlacementOutcome`;
  - `placeCatalogOrder(deps: { store: CatalogOrderStore; adapters: Readonly<Record<CatalogSupplier, SupplierAdapter>> }, orderId: string): Promise<PlacementOutcome>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { MAX_PLACEMENT_ATTEMPTS, nextRetryDelayMs, placeCatalogOrder } from './placement';
import { memoryCatalogStore } from './test-support';
import type { PlaceOrderResult, SupplierAdapter } from './supplier';

const ADDRESS = { name: 'Ada', line1: '1 Main St', line2: null, city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US', phone: null, email: null };

async function storeWithOrder() {
	const store = memoryCatalogStore();
	await store.insertPaidOrder({
		id: 'co_1',
		sellerUserId: 'u1',
		storeAppId: 'app_1',
		checkoutSessionId: 'cs_1',
		paymentIntentId: 'pi_1',
		totalCents: 9000,
		catalogTotalCents: 3600,
		applicationFeeCents: 3891,
		destinationCountry: 'US',
		shippingAddress: ADDRESS,
		items: [
			{ id: 'ci_mug', catalogVariantId: 'cv_mug', supplier: 'cjdropshipping', supplierVariantId: 'cj_mug', quantity: 2, unitPriceCents: 2500, catalogPriceCents: 1200 },
			{ id: 'ci_cap', catalogVariantId: 'cv_cap', supplier: 'cjdropshipping', supplierVariantId: 'cj_cap', quantity: 1, unitPriceCents: 4000, catalogPriceCents: 1200 },
		],
		createdAt: new Date(0),
	});
	return store;
}

/** An adapter that answers each call in turn and remembers what it was sent. */
function scriptedAdapter(results: PlaceOrderResult[]) {
	const calls: Array<{ orderReference: string; variants: string[] }> = [];
	const adapter: SupplierAdapter = {
		supplier: 'cjdropshipping',
		async placeOrder(input) {
			calls.push({ orderReference: input.orderReference, variants: input.lines.map((line) => line.supplierVariantId) });
			const result = results.shift();
			if (!result) throw new Error('No scripted result left');
			return result;
		},
	};
	return { adapter, calls };
}

describe('nextRetryDelayMs', () => {
	it('backs off from a minute to three hours', () => {
		expect([1, 2, 3, 4, 5, 9].map(nextRetryDelayMs)).toEqual([60_000, 300_000, 900_000, 3_600_000, 10_800_000, 10_800_000]);
	});
});

describe('placeCatalogOrder', () => {
	it('places every pending item with one supplier order and finishes', async () => {
		const store = await storeWithOrder();
		const { adapter, calls } = scriptedAdapter([{ ok: true, supplierOrderId: 'cj_9' }]);

		expect(await placeCatalogOrder({ store, adapters: { cjdropshipping: adapter } }, 'co_1')).toEqual({ kind: 'done', rejectedItemIds: [] });
		expect(calls).toEqual([{ orderReference: 'co_1', variants: ['cj_mug', 'cj_cap'] }]);
		expect(store.orders.get('co_1')?.items.map((item) => [item.status, item.supplierOrderId])).toEqual([
			['placed', 'cj_9'],
			['placed', 'cj_9'],
		]);
		expect(store.orders.get('co_1')?.status).toBe('placement-done');
	});

	it('rejects the named variants and places the rest straight away', async () => {
		const store = await storeWithOrder();
		const { adapter, calls } = scriptedAdapter([
			{ ok: false, kind: 'rejected', reason: 'Out of stock', rejectedVariantIds: ['cj_cap'] },
			{ ok: true, supplierOrderId: 'cj_10' },
		]);

		expect(await placeCatalogOrder({ store, adapters: { cjdropshipping: adapter } }, 'co_1')).toEqual({ kind: 'done', rejectedItemIds: ['ci_cap'] });
		expect(calls.map((call) => call.variants)).toEqual([['cj_mug', 'cj_cap'], ['cj_mug']]);
		expect(store.orders.get('co_1')?.items.map((item) => item.status)).toEqual(['placed', 'rejected']);
	});

	it('rejects every line sent when a rejection names none of them', async () => {
		const store = await storeWithOrder();
		const { adapter } = scriptedAdapter([{ ok: false, kind: 'rejected', reason: 'Undeliverable address', rejectedVariantIds: ['cj_unknown'] }]);

		expect(await placeCatalogOrder({ store, adapters: { cjdropshipping: adapter } }, 'co_1')).toEqual({
			kind: 'done',
			rejectedItemIds: ['ci_mug', 'ci_cap'],
		});
	});

	it('schedules a retry on a temporary failure, with the same order reference next time', async () => {
		const store = await storeWithOrder();
		const { adapter, calls } = scriptedAdapter([
			{ ok: false, kind: 'retryable', reason: 'Timed out' },
			{ ok: true, supplierOrderId: 'cj_11' },
		]);
		const deps = { store, adapters: { cjdropshipping: adapter } };

		expect(await placeCatalogOrder(deps, 'co_1')).toEqual({ kind: 'retry', delayMs: 60_000 });
		expect(store.orders.get('co_1')).toMatchObject({ status: 'awaiting-placement', placementAttempts: 1, lastError: 'Timed out' });
		expect(await placeCatalogOrder(deps, 'co_1')).toEqual({ kind: 'done', rejectedItemIds: [] });
		expect(calls.map((call) => call.orderReference)).toEqual(['co_1', 'co_1']);
	});

	it('hands the order to the owner after the last attempt fails', async () => {
		const store = await storeWithOrder();
		const failures: PlaceOrderResult[] = Array.from({ length: MAX_PLACEMENT_ATTEMPTS }, () => ({ ok: false, kind: 'retryable', reason: 'Supplier down' }));
		const { adapter } = scriptedAdapter(failures);
		const deps = { store, adapters: { cjdropshipping: adapter } };

		for (let attempt = 1; attempt < MAX_PLACEMENT_ATTEMPTS; attempt += 1) expect((await placeCatalogOrder(deps, 'co_1')).kind).toBe('retry');
		expect(await placeCatalogOrder(deps, 'co_1')).toEqual({ kind: 'needs-attention', reason: 'Supplier down' });
		expect(store.orders.get('co_1')?.status).toBe('needs-attention');
	});

	it('does nothing for an order with nothing left to place, or no order at all', async () => {
		const store = await storeWithOrder();
		const { adapter, calls } = scriptedAdapter([{ ok: true, supplierOrderId: 'cj_12' }]);
		const deps = { store, adapters: { cjdropshipping: adapter } };

		await placeCatalogOrder(deps, 'co_1');
		expect(await placeCatalogOrder(deps, 'co_1')).toEqual({ kind: 'done', rejectedItemIds: [] });
		expect(calls).toHaveLength(1);
		expect(await placeCatalogOrder(deps, 'co_missing')).toEqual({ kind: 'not-found' });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run worker/services/catalog/placement.test.ts`
Expected: FAIL, "Failed to load url ./placement".

- [ ] **Step 3: Write the orchestrator**

```ts
/**
 * Places a catalog order's pending items with their suppliers. The scheduler that calls it (supplier connection spec)
 * runs it after the webhook answers and again after each `retry` delay; rejected items go to refundCatalogItems.
 */

import { CATALOG_SUPPLIERS, type CatalogSupplier } from '../../../shared/types/catalog';
import type { CatalogOrderItemRow, CatalogOrderStore, ItemPatch } from './store';
import type { ShippingAddress, SupplierAdapter } from './supplier';

export const MAX_PLACEMENT_ATTEMPTS = 6;

const RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000, 10_800_000] as const;

/** The wait before the next attempt, after `failedAttempts` failures: a minute, rising to three hours. */
export function nextRetryDelayMs(failedAttempts: number): number {
	const index = Math.min(Math.max(failedAttempts, 1), RETRY_DELAYS_MS.length) - 1;
	return RETRY_DELAYS_MS[index];
}

export type PlacementOutcome =
	| { kind: 'done'; rejectedItemIds: readonly string[] }
	| { kind: 'retry'; delayMs: number }
	| { kind: 'needs-attention'; reason: string }
	| { kind: 'not-found' };

export interface PlacementDeps {
	store: CatalogOrderStore;
	adapters: Readonly<Record<CatalogSupplier, SupplierAdapter>>;
}

/** One supplier's pending lines: placed, rejected (then the rest tried once more), or left for a retry. */
async function placeWithSupplier(
	deps: PlacementDeps,
	orderId: string,
	address: ShippingAddress,
	pending: readonly CatalogOrderItemRow[],
	supplier: CatalogSupplier,
): Promise<{ rejectedItemIds: string[]; retryReason: string | null }> {
	let lines = pending;
	const rejectedItemIds: string[] = [];
	for (let call = 0; call < 2 && lines.length > 0; call += 1) {
		const result = await deps.adapters[supplier].placeOrder({
			orderReference: orderId,
			lines: lines.map((item) => ({ supplierVariantId: item.supplierVariantId, quantity: item.quantity })),
			address,
		});
		if (result.ok) {
			await deps.store.patchItems(lines.map((item): ItemPatch => ({ itemId: item.id, status: 'placed', supplierOrderId: result.supplierOrderId })));
			return { rejectedItemIds, retryReason: null };
		}
		if (result.kind === 'retryable') return { rejectedItemIds, retryReason: result.reason };
		const named = lines.filter((item) => result.rejectedVariantIds.includes(item.supplierVariantId));
		// A rejection that names none of the lines sent rejects them all, so nothing is silently left pending.
		const rejected = named.length > 0 ? named : lines;
		await deps.store.patchItems(rejected.map((item): ItemPatch => ({ itemId: item.id, status: 'rejected' })));
		rejectedItemIds.push(...rejected.map((item) => item.id));
		lines = lines.filter((item) => !rejected.includes(item));
	}
	return { rejectedItemIds, retryReason: lines.length > 0 ? 'Lines left after a partial rejection' : null };
}

export async function placeCatalogOrder(deps: PlacementDeps, orderId: string): Promise<PlacementOutcome> {
	const order = await deps.store.getOrder(orderId);
	if (!order) return { kind: 'not-found' };
	const pending = order.items.filter((item) => item.status === 'pending');
	if (pending.length === 0) return { kind: 'done', rejectedItemIds: [] };

	const rejectedItemIds: string[] = [];
	let retryReason: string | null = null;
	for (const supplier of CATALOG_SUPPLIERS) {
		const lines = pending.filter((item) => item.supplier === supplier);
		if (lines.length === 0) continue;
		const result = await placeWithSupplier(deps, order.id, order.shippingAddress, lines, supplier);
		rejectedItemIds.push(...result.rejectedItemIds);
		retryReason ??= result.retryReason;
	}

	const placementAttempts = order.placementAttempts + 1;
	if (retryReason === null) {
		await deps.store.updateOrder(order.id, { status: 'placement-done', placementAttempts, lastError: null });
		return { kind: 'done', rejectedItemIds };
	}
	if (placementAttempts >= MAX_PLACEMENT_ATTEMPTS) {
		await deps.store.updateOrder(order.id, { status: 'needs-attention', placementAttempts, lastError: retryReason });
		return { kind: 'needs-attention', reason: retryReason };
	}
	await deps.store.updateOrder(order.id, { status: 'awaiting-placement', placementAttempts, lastError: retryReason });
	return { kind: 'retry', delayMs: nextRetryDelayMs(placementAttempts) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy npx vitest run worker/services/catalog/placement.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/services/catalog/placement.ts worker/services/catalog/placement.test.ts
git commit -m "feat(catalog): place supplier orders with retries and partial rejections

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Turn supplier reports into item changes

**Files:**
- Create: `worker/services/catalog/updates.ts`
- Test: `worker/services/catalog/updates.test.ts`

**Interfaces:**
- Consumes: Task 4 (`CatalogOrderItemRow`, `ItemPatch`, `SupplierUpdate`).
- Produces: `applySupplierUpdate(items: readonly CatalogOrderItemRow[], update: SupplierUpdate): readonly ItemPatch[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { applySupplierUpdate } from './updates';
import type { CatalogOrderItemRow } from './store';

const ITEM: CatalogOrderItemRow = {
	id: 'ci_mug',
	catalogVariantId: 'cv_mug',
	supplier: 'cjdropshipping',
	supplierVariantId: 'cj_mug',
	quantity: 2,
	unitPriceCents: 2500,
	catalogPriceCents: 1200,
	status: 'placed',
	supplierOrderId: 'cj_9',
	supplierRefunded: false,
};

describe('applySupplierUpdate', () => {
	it('marks the supplier order shipped, with tracking', () => {
		expect(applySupplierUpdate([ITEM], { kind: 'shipped', supplierOrderId: 'cj_9', trackingNumber: '1Z999', carrier: 'UPS' })).toEqual([
			{ itemId: 'ci_mug', status: 'shipped', trackingNumber: '1Z999', carrier: 'UPS' },
		]);
	});

	it('marks it delivered, from placed or shipped', () => {
		expect(applySupplierUpdate([{ ...ITEM, status: 'shipped' }], { kind: 'delivered', supplierOrderId: 'cj_9' })).toEqual([{ itemId: 'ci_mug', status: 'delivered' }]);
		expect(applySupplierUpdate([ITEM], { kind: 'delivered', supplierOrderId: 'cj_9' })).toEqual([{ itemId: 'ci_mug', status: 'delivered' }]);
	});

	it('never moves an item backwards, and ignores repeated reports', () => {
		expect(applySupplierUpdate([{ ...ITEM, status: 'delivered' }], { kind: 'shipped', supplierOrderId: 'cj_9', trackingNumber: '1Z999', carrier: 'UPS' })).toEqual([]);
		expect(applySupplierUpdate([{ ...ITEM, status: 'refunded' }], { kind: 'delivered', supplierOrderId: 'cj_9' })).toEqual([]);
	});

	it('records a supplier refund once, for the variants it names', () => {
		const cap = { ...ITEM, id: 'ci_cap', supplierVariantId: 'cj_cap' };
		expect(applySupplierUpdate([ITEM, cap], { kind: 'refunded', supplierOrderId: 'cj_9', supplierVariantIds: ['cj_cap'] })).toEqual([
			{ itemId: 'ci_cap', supplierRefunded: true },
		]);
		expect(applySupplierUpdate([{ ...cap, supplierRefunded: true }], { kind: 'refunded', supplierOrderId: 'cj_9', supplierVariantIds: ['cj_cap'] })).toEqual([]);
	});

	it("leaves other supplier orders' items alone", () => {
		expect(applySupplierUpdate([ITEM], { kind: 'delivered', supplierOrderId: 'cj_other' })).toEqual([]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run worker/services/catalog/updates.test.ts`
Expected: FAIL, "Failed to load url ./updates".

- [ ] **Step 3: Write the function**

```ts
/** A supplier's report on one of its orders, as changes to the matching catalog items. */

import type { CatalogItemStatus } from '../../../shared/types/catalog';
import type { CatalogOrderItemRow, ItemPatch } from './store';
import type { SupplierUpdate } from './supplier';

/** How far an item has come; rejected and refunded items are closed and never move again. */
const PROGRESS: Readonly<Record<CatalogItemStatus, number>> = { pending: 0, placed: 1, shipped: 2, delivered: 3, rejected: -1, refunded: -1 };

export function applySupplierUpdate(items: readonly CatalogOrderItemRow[], update: SupplierUpdate): readonly ItemPatch[] {
	const ours = items.filter((item) => item.supplierOrderId === update.supplierOrderId);
	if (update.kind === 'refunded') {
		return ours
			.filter((item) => update.supplierVariantIds.includes(item.supplierVariantId) && !item.supplierRefunded)
			.map((item): ItemPatch => ({ itemId: item.id, supplierRefunded: true }));
	}
	const target: CatalogItemStatus = update.kind;
	const moving = ours.filter((item) => PROGRESS[item.status] >= PROGRESS.placed && PROGRESS[item.status] < PROGRESS[target]);
	return moving.map((item): ItemPatch =>
		update.kind === 'shipped'
			? { itemId: item.id, status: 'shipped', trackingNumber: update.trackingNumber, carrier: update.carrier }
			: { itemId: item.id, status: 'delivered' },
	);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy npx vitest run worker/services/catalog/updates.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/services/catalog/updates.ts worker/services/catalog/updates.test.ts
git commit -m "feat(catalog): supplier shipping, delivery and refund reports as item changes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Stripe refunds and transfer reversals

**Files:**
- Modify: `worker/services/payments/stripe-client.ts` (types near `StripeCheckoutSession`, methods on `StripeClient`, implementations at the end of `createStripeClient`)
- Test: `worker/services/payments/stripe-client.test.ts` (new `describe` at the end)

**Interfaces:**
- Consumes: the existing `request` helper and `encodeForm`.
- Produces:
  - `StripePaymentIntent = { id: string; latest_charge: { id: string; transfer: string | null } | string | null }`;
  - `StripeRefund = { id: string; amount: number; status: string }`, `StripeTransferReversal = { id: string; amount: number }`;
  - `retrievePaymentIntent(paymentIntentId: string): Promise<StripePaymentIntent>` (expands `latest_charge`);
  - `createRefund(input: { paymentIntentId: string; amountCents: number; idempotencyKey: string; metadata: Record<string, string> }): Promise<StripeRefund>`;
  - `createTransferReversal(input: { transferId: string; amountCents: number; idempotencyKey: string; metadata: Record<string, string> }): Promise<StripeTransferReversal>`.

- [ ] **Step 1: Write the failing test**

Append to `worker/services/payments/stripe-client.test.ts`:

```ts
describe('refunds for catalog items', () => {
	function recordingFetch(response: unknown) {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const fakeFetch: typeof fetch = async (input, init) => {
			calls.push({ url: String(input), init: init ?? {} });
			return new Response(JSON.stringify(response), { status: 200 });
		};
		return { calls, fakeFetch };
	}

	it("reads the payment's charge and its transfer to the seller", async () => {
		const { calls, fakeFetch } = recordingFetch({ id: 'pi_1', latest_charge: { id: 'ch_1', transfer: 'tr_1' } });
		const intent = await createStripeClient('sk_test_fake', fakeFetch).retrievePaymentIntent('pi_1');

		expect(intent.latest_charge).toEqual({ id: 'ch_1', transfer: 'tr_1' });
		expect(calls[0].init.method).toBe('GET');
		expect(decodeURIComponent(calls[0].url)).toBe('https://api.stripe.com/v1/payment_intents/pi_1?expand[0]=latest_charge');
	});

	it('refunds part of a payment once per idempotency key', async () => {
		const { calls, fakeFetch } = recordingFetch({ id: 're_1', amount: 5000, status: 'succeeded' });
		await createStripeClient('sk_test_fake', fakeFetch).createRefund({
			paymentIntentId: 'pi_1',
			amountCents: 5000,
			idempotencyKey: 'catalog-refund-co_1-ci_cap',
			metadata: { catalogOrderId: 'co_1' },
		});

		expect(calls[0].url).toBe('https://api.stripe.com/v1/refunds');
		expect(new Headers(calls[0].init.headers).get('Idempotency-Key')).toBe('catalog-refund-co_1-ci_cap');
		const body = decodeURIComponent(String(calls[0].init.body));
		expect(body).toContain('payment_intent=pi_1');
		expect(body).toContain('amount=5000');
		expect(body).toContain('metadata[catalogOrderId]=co_1');
	});

	it("takes the seller's share back from their transfer", async () => {
		const { calls, fakeFetch } = recordingFetch({ id: 'trr_1', amount: 2600 });
		await createStripeClient('sk_test_fake', fakeFetch).createTransferReversal({
			transferId: 'tr_1',
			amountCents: 2600,
			idempotencyKey: 'catalog-reversal-co_1-ci_cap',
			metadata: { catalogOrderId: 'co_1' },
		});

		expect(calls[0].url).toBe('https://api.stripe.com/v1/transfers/tr_1/reversals');
		expect(new Headers(calls[0].init.headers).get('Idempotency-Key')).toBe('catalog-reversal-co_1-ci_cap');
		expect(decodeURIComponent(String(calls[0].init.body))).toContain('amount=2600');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run worker/services/payments/stripe-client.test.ts`
Expected: FAIL, "retrievePaymentIntent is not a function".

- [ ] **Step 3: Add the types and methods**

Add after the `StripeCheckoutSession` interface:

```ts
export interface StripePaymentIntent {
	id: string;
	/** Expanded on request: the charge, with the transfer that paid the seller on a destination charge. */
	latest_charge: { id: string; transfer: string | null } | string | null;
}

export interface StripeRefund {
	id: string;
	amount: number;
	status: string;
}

export interface StripeTransferReversal {
	id: string;
	amount: number;
}
```

Add to the `StripeClient` interface:

```ts
	retrievePaymentIntent(paymentIntentId: string): Promise<StripePaymentIntent>;
	createRefund(input: { paymentIntentId: string; amountCents: number; idempotencyKey: string; metadata: Record<string, string> }): Promise<StripeRefund>;
	createTransferReversal(input: { transferId: string; amountCents: number; idempotencyKey: string; metadata: Record<string, string> }): Promise<StripeTransferReversal>;
```

Add to the object `createStripeClient` returns, after `retrieveCheckoutSession`:

```ts
		retrievePaymentIntent: (paymentIntentId) =>
			request<StripePaymentIntent>('GET', `/payment_intents/${encodeURIComponent(paymentIntentId)}?${encodeForm({ expand: ['latest_charge'] })}`),
		// Catalog refunds carry stable idempotency keys, so a retried refund is never paid twice.
		createRefund: (input) =>
			request<StripeRefund>(
				'POST',
				'/refunds',
				{ payment_intent: input.paymentIntentId, amount: input.amountCents, metadata: input.metadata },
				input.idempotencyKey,
			),
		createTransferReversal: (input) =>
			request<StripeTransferReversal>(
				'POST',
				`/transfers/${encodeURIComponent(input.transferId)}/reversals`,
				{ amount: input.amountCents, metadata: input.metadata },
				input.idempotencyKey,
			),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy npx vitest run worker/services/payments/stripe-client.test.ts`
Expected: PASS, all tests in the file, including the three new ones.

- [ ] **Step 5: Commit**

```bash
git add worker/services/payments/stripe-client.ts worker/services/payments/stripe-client.test.ts
git commit -m "feat(payments): stripe refunds and transfer reversals for catalog items

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Refund catalog items

**Files:**
- Create: `worker/services/catalog/refund-items.ts`
- Test: `worker/services/catalog/refund-items.test.ts`

**Interfaces:**
- Consumes: Task 2 (`itemRefundSplit`, `RefundReason`), Task 4 (`CatalogOrderStore`), Task 5 (`memoryCatalogStore`), Task 8 (`StripeClient` methods).
- Produces: `refundCatalogItems(deps: { store: CatalogOrderStore; stripe: Pick<StripeClient, 'retrievePaymentIntent' | 'createRefund' | 'createTransferReversal'> }, input: { orderId: string; itemIds: readonly string[]; reason: RefundReason }): Promise<RefundTotals>` with `RefundTotals = { refundedItemIds: readonly string[]; shopperCents: number; sellerCents: number; estoriCents: number }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { refundCatalogItems } from './refund-items';
import { memoryCatalogStore } from './test-support';
import type { StripeClient } from '../payments/stripe-client';

const ADDRESS = { name: 'Ada', line1: '1 Main St', line2: null, city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US', phone: null, email: null };

async function storeWithOrder() {
	const store = memoryCatalogStore();
	await store.insertPaidOrder({
		id: 'co_1',
		sellerUserId: 'u1',
		storeAppId: 'app_1',
		checkoutSessionId: 'cs_1',
		paymentIntentId: 'pi_1',
		totalCents: 9000,
		catalogTotalCents: 3600,
		applicationFeeCents: 3891,
		destinationCountry: 'US',
		shippingAddress: ADDRESS,
		items: [
			{ id: 'ci_mug', catalogVariantId: 'cv_mug', supplier: 'cjdropshipping', supplierVariantId: 'cj_mug', quantity: 2, unitPriceCents: 2500, catalogPriceCents: 1200 },
			{ id: 'ci_cap', catalogVariantId: 'cv_cap', supplier: 'cjdropshipping', supplierVariantId: 'cj_cap', quantity: 1, unitPriceCents: 4000, catalogPriceCents: 1200 },
		],
		createdAt: new Date(0),
	});
	return store;
}

function fakeStripe(transfer: string | null = 'tr_1') {
	const refunds: Array<{ amountCents: number; idempotencyKey: string }> = [];
	const reversals: Array<{ amountCents: number; idempotencyKey: string }> = [];
	const stripe: Pick<StripeClient, 'retrievePaymentIntent' | 'createRefund' | 'createTransferReversal'> = {
		retrievePaymentIntent: async (id) => ({ id, latest_charge: { id: 'ch_1', transfer } }),
		createRefund: async (input) => {
			refunds.push({ amountCents: input.amountCents, idempotencyKey: input.idempotencyKey });
			return { id: 're_1', amount: input.amountCents, status: 'succeeded' };
		},
		createTransferReversal: async (input) => {
			reversals.push({ amountCents: input.amountCents, idempotencyKey: input.idempotencyKey });
			return { id: 'trr_1', amount: input.amountCents };
		},
	};
	return { stripe, refunds, reversals };
}

describe('refundCatalogItems', () => {
	it('refunds rejected items in full, taking back only the seller share', async () => {
		const store = await storeWithOrder();
		const { stripe, refunds, reversals } = fakeStripe();

		const totals = await refundCatalogItems({ store, stripe }, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' });
		expect(totals).toEqual({ refundedItemIds: ['ci_cap'], shopperCents: 4000, sellerCents: 2800, estoriCents: 1200 });
		expect(refunds).toEqual([{ amountCents: 4000, idempotencyKey: 'catalog-refund-co_1-ci_cap' }]);
		expect(reversals).toEqual([{ amountCents: 2800, idempotencyKey: 'catalog-reversal-co_1-ci_cap' }]);
		expect(store.orders.get('co_1')?.items.find((item) => item.id === 'ci_cap')?.status).toBe('refunded');
	});

	it('charges the whole refund to the seller when the supplier kept the money', async () => {
		const store = await storeWithOrder();
		const { stripe, reversals } = fakeStripe();

		const totals = await refundCatalogItems({ store, stripe }, { orderId: 'co_1', itemIds: ['ci_mug'], reason: 'seller-refund' });
		expect(totals).toMatchObject({ shopperCents: 5000, sellerCents: 5000, estoriCents: 0 });
		expect(reversals[0].amountCents).toBe(5000);
	});

	it('skips items already refunded, so a retry refunds nobody twice', async () => {
		const store = await storeWithOrder();
		const { stripe, refunds } = fakeStripe();

		await refundCatalogItems({ store, stripe }, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' });
		const again = await refundCatalogItems({ store, stripe }, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' });
		expect(again).toEqual({ refundedItemIds: [], shopperCents: 0, sellerCents: 0, estoriCents: 0 });
		expect(refunds).toHaveLength(1);
	});

	it('makes the same idempotency keys whatever order the items are listed in', async () => {
		const first = fakeStripe();
		await refundCatalogItems({ store: await storeWithOrder(), stripe: first.stripe }, { orderId: 'co_1', itemIds: ['ci_mug', 'ci_cap'], reason: 'seller-refund' });
		const second = fakeStripe();
		await refundCatalogItems({ store: await storeWithOrder(), stripe: second.stripe }, { orderId: 'co_1', itemIds: ['ci_cap', 'ci_mug'], reason: 'seller-refund' });
		expect(second.refunds[0].idempotencyKey).toBe(first.refunds[0].idempotencyKey);
	});

	it('refuses a payment with no transfer to reverse, before refunding anything', async () => {
		const store = await storeWithOrder();
		const { stripe, refunds } = fakeStripe(null);

		await expect(refundCatalogItems({ store, stripe }, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' })).rejects.toThrow(
			'The payment has no transfer to the seller',
		);
		expect(refunds).toHaveLength(0);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run worker/services/catalog/refund-items.test.ts`
Expected: FAIL, "Failed to load url ./refund-items".

- [ ] **Step 3: Write the orchestrator**

```ts
/**
 * Refunds catalog items: the shopper gets the retail price back, the seller's share comes back from their transfer, and
 * Estori pays the rest (the catalog price, when the supplier never kept it). Keys depend only on the items, so a retry
 * repeats the same Stripe calls instead of paying twice.
 */

import type { StripeClient } from '../payments/stripe-client';
import { itemRefundSplit, type RefundReason } from './refunds';
import type { CatalogOrderStore, ItemPatch } from './store';

export interface RefundItemsDeps {
	store: CatalogOrderStore;
	stripe: Pick<StripeClient, 'retrievePaymentIntent' | 'createRefund' | 'createTransferReversal'>;
}

export interface RefundTotals {
	refundedItemIds: readonly string[];
	shopperCents: number;
	sellerCents: number;
	estoriCents: number;
}

const NOTHING: RefundTotals = { refundedItemIds: [], shopperCents: 0, sellerCents: 0, estoriCents: 0 };

export async function refundCatalogItems(deps: RefundItemsDeps, input: { orderId: string; itemIds: readonly string[]; reason: RefundReason }): Promise<RefundTotals> {
	const order = await deps.store.getOrder(input.orderId);
	if (!order) throw new Error(`Catalog order ${input.orderId} does not exist`);
	const items = order.items.filter((item) => input.itemIds.includes(item.id) && item.status !== 'refunded').sort((a, b) => a.id.localeCompare(b.id));
	if (items.length === 0) return NOTHING;

	const totals = items.reduce(
		(sum, item) => {
			const split = itemRefundSplit({
				reason: input.reason,
				retailCents: item.unitPriceCents * item.quantity,
				catalogCents: item.catalogPriceCents * item.quantity,
				supplierRefunded: item.supplierRefunded,
			});
			return { shopperCents: sum.shopperCents + split.shopperCents, sellerCents: sum.sellerCents + split.sellerCents, estoriCents: sum.estoriCents + split.estoriCents };
		},
		{ shopperCents: 0, sellerCents: 0, estoriCents: 0 },
	);

	const intent = await deps.stripe.retrievePaymentIntent(order.paymentIntentId);
	const transferId = typeof intent.latest_charge === 'object' && intent.latest_charge !== null ? intent.latest_charge.transfer : null;
	if (!transferId) throw new Error('The payment has no transfer to the seller to reverse');

	const keySuffix = `${order.id}-${items.map((item) => item.id).join('.')}`;
	const metadata = { catalogOrderId: order.id, reason: input.reason };
	await deps.stripe.createRefund({ paymentIntentId: order.paymentIntentId, amountCents: totals.shopperCents, idempotencyKey: `catalog-refund-${keySuffix}`, metadata });
	if (totals.sellerCents > 0) {
		await deps.stripe.createTransferReversal({ transferId, amountCents: totals.sellerCents, idempotencyKey: `catalog-reversal-${keySuffix}`, metadata });
	}
	await deps.store.patchItems(items.map((item): ItemPatch => ({ itemId: item.id, status: 'refunded' })));
	return { refundedItemIds: items.map((item) => item.id), ...totals };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy npx vitest run worker/services/catalog/refund-items.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify the whole change**

Run, one after another:
- `rtk proxy npx tsc --noEmit -p tsconfig.app.json` and `rtk proxy npx tsc --noEmit -p tsconfig.worker.json`. Expected: no errors outside `packages/artifacts-viewer` (those predate this plan). If the worker config doesn't include `shared/types/catalog.ts`, check how it includes `shared/` (`"./shared"` is in its include list) before changing anything.
- `rtk proxy npx vitest run shared/types/catalog.test.ts worker/services/catalog worker/database/catalog-schema.test.ts worker/database/services/CatalogOrderService.test.ts worker/services/payments`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/services/catalog/refund-items.ts worker/services/catalog/refund-items.test.ts
git commit -m "feat(catalog): refund catalog items with a refund and a transfer reversal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Not in this plan (and where it goes)

- **Running placement in the background and polling or receiving supplier updates:** the supplier connection spec (`2026-10-15-cjdropshipping-adapter-design.md`). It needs a Durable Object binding and migration in `wrangler.jsonc`, which the owner commits.
- **Calling `recordPaidCatalogOrder` from Stripe's webhook and putting `checkCart`'s fee on the Checkout session:** the shopper checkout spec (`2026-10-15-shopper-checkout-design.md`), which defines how a paid session carries its cart and address.
- **The seller's saved card for extra costs (`catalog_billing`, a setup-mode Checkout and off-session charges):** after the first two exist, since nothing can incur an extra cost until orders are placed. Ruling: deferred, at no cost to the pieces above.
- **Chargebacks:** Stripe's dispute events arrive in the webhook the checkout spec wires; recovery reuses Task 8's transfer reversal.
- **Linking to store orders:** the checkout spec adds `store_orders`, and asks that `catalog_orders` reference `store_orders.id`. Both share the Checkout session id, which this plan already stores uniquely, so a later migration adds `store_order_id` once `store_orders` exists.
