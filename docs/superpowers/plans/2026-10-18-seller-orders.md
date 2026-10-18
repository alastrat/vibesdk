# Seller Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sellers get an Orders page across their stores, can mark orders shipped and refund lines from it, and receive an email for every new order.

**Architecture:**
- **Data:** `SellerOrderService` (D1, Drizzle) holds the list, the order facts and the shipment write, every query scoped to the signed-in seller.
- **API:** `SellerOrdersController` exposes `/api/orders`, `/api/orders/:id` and `/api/orders/:id/shipment`.
- **Email:** `recordStoreOrder` calls a new `notifyNewOrder` dependency once an order is first recorded. It sends `sellerNewOrderEmail` through the existing email sender, under a KV daily cap.
- **Pages:** `/orders` and `/orders/:id` follow the admin catalog-orders pages' patterns, and a sidebar item opens them.

**Tech Stack:** Cloudflare Workers, D1 (Drizzle), KV, React 19, TanStack Query 5, kumo UI, Vitest with `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-10-18-seller-orders-design.md`

## Global Constraints

- **Types:** no `any`. Shared types live in `shared/types/store-payments.ts`, and the frontend imports them from `@/api-types`.
- **Copy and comments:**
  - No emojis.
  - Comments are short and say why.
  - Seller pages and emails name no supplier or AI assistant; catalog items read "Estori ships".
- **Paths:** `SELLER_ORDERS_PATH = '/orders'`, and `sellerOrderPath(id)` builds `/orders/<id>`.
- **Views and modes:** views are `to-ship | all` (default `to-ship`); modes are `live | all` (default `live`, which hides test orders).
- **To-ship rule:** the payment is `paid` or `partially_refunded`, `fulfillment_status` is `unfulfilled`, and at least one `own` line has no `store_refunds` row.
- **Email cap:** 100 new-order emails per seller per UTC day, test and live together. The KV key is `seller-order-emails:{sellerUserId}:{YYYY-MM-DD}`, with a TTL of 2 days.
- **Subjects:** `New order #{n} at {store}: ${total}`; test orders prefix `[Test] `.
- **Commits:** subjects lowercase after the type prefix, ending with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Never commit:**
  - `wrangler.jsonc`, `.dev.vars`, `bun.lockb`;
  - `.superpowers/`, `.playwright-mcp/`;
  - `src/routes/landing/LandingPage.tsx`;
  - `docs/superpowers/specs/2026-10-18-shopper-order-access-design.md`.
- **Tests:** single files run with `rtk proxy bunx vitest run <paths>`; the full suite is `bun run test`.

## Review Focus

- An order whose store app was deleted (no `apps` row; `store_orders.app_id` has no foreign key) has a null `storeTitle`. The page shows "Deleted store" and the email says "your store". Pinned in Task 2 (SQL) and Task 6 (format).
- An order without a shipping address or customer name shows "No shipping address on this order" and "Unknown shopper" instead of breaking. Pinned in Task 6.
- Double-clicking Refund or Mark shipped sends one request: the buttons disable while a request is pending, and each refund attempt makes one `requestId`. Pinned in Task 8 (source guard).
- A note or product name with markup or line breaks is escaped in the email, with line breaks kept. Pinned in Task 5.
- The daily cap rolls over at UTC midnight, not at the server's local day. Pinned in Task 5.

---

### Task 1: Shipment columns, migration and shared types

**Files:**
- Modify: `worker/database/schema.ts` (store_orders: `shippedAt` column; index swap)
- Create: `migrations/0027_seller_order_shipments.sql` and its snapshot (generated)
- Modify: `shared/types/store-payments.ts`
- Create: `worker/database/services/keyset-cursor.ts`
- Modify: `worker/database/services/CatalogOrderAdminService.ts`, `worker/api/controllers/catalog/controller.ts` (use the shared cursor)
- Test: `worker/database/services/seller-orders.sql.test.ts`, `shared/types/store-payments.test.ts` (create if missing)

**Interfaces:**
- Produces:
  - `SELLER_ORDERS_PATH`, `sellerOrderPath(orderId: string): string`;
  - `SELLER_ORDER_VIEWS`, `SellerOrderView`, `isSellerOrderView`;
  - `SELLER_ORDER_MODES`, `SellerOrderModeFilter`, `isSellerOrderModeFilter`;
  - `SELLER_CARRIERS`, `SellerCarrier`, `SELLER_CARRIER_NAMES`;
  - `SellerOrderRow`, `SellerOrdersData`, `SellerOrderLine`, `SellerOrderDetail`, `SellerShipmentRequest`;
  - `parseKeysetCursor(cursor): { createdAt: Date; id: string } | null` and `keysetCursorOf(createdAt: Date, id: string): string`.

- [ ] **Step 1: Write the failing tests**

`worker/database/services/seller-orders.sql.test.ts` (first test; later tasks add more):
```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { migratedD1 } from '../test-support/real-d1';

let db: D1Database;
beforeAll(async () => {
	db = await migratedD1();
});

describe('seller orders on real SQL', () => {
	it("records when an order shipped, and lists a seller's orders by date from one index", async () => {
		const table = await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'store_orders'").first<{ sql: string }>();
		expect(table?.sql).toContain('`shipped_at` integer');
		const indexes = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'store_orders'").all<{ name: string }>();
		const names = indexes.results.map((row) => row.name);
		expect(names).toContain('store_orders_seller_created_idx');
		expect(names).not.toContain('store_orders_seller_idx');
	});
});
```
`shared/types/store-payments.test.ts` (append, or create with this content):
```ts
import { describe, expect, it } from 'vitest';
import { isSellerOrderModeFilter, isSellerOrderView, sellerOrderPath } from './store-payments';

describe('seller order paths and filters', () => {
	it('links an order under the Orders page', () => {
		expect(sellerOrderPath('ord_ab12')).toBe('/orders/ord_ab12');
	});
	it('knows its views and modes', () => {
		expect(isSellerOrderView('to-ship')).toBe(true);
		expect(isSellerOrderView('late')).toBe(false);
		expect(isSellerOrderModeFilter('all')).toBe(true);
		expect(isSellerOrderModeFilter('test')).toBe(false);
	});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `rtk proxy bunx vitest run worker/database/services/seller-orders.sql.test.ts shared/types/store-payments.test.ts`
Expected: FAIL. The schema lacks `shipped_at`, and the helpers aren't exported.

- [ ] **Step 3: Implement**

In `schema.ts`, in the `store_orders` table:
- after `carrier: text('carrier'),` add `shippedAt: integer('shipped_at', { mode: 'timestamp' }),`;
- replace `sellerIdx: index('store_orders_seller_idx').on(table.sellerUserId),` with `sellerCreatedIdx: index('store_orders_seller_created_idx').on(table.sellerUserId, table.createdAt),`.

Then run `bun run db:generate -- --name seller_order_shipments`. Expect `migrations/0027_seller_order_shipments.sql` to drop the old index, add the column and create the new index.

Append to `shared/types/store-payments.ts`:
```ts
/** The seller's Orders page; the new-order email links to one order under it. */
export const SELLER_ORDERS_PATH = '/orders';

export function sellerOrderPath(orderId: string): string {
	return `${SELLER_ORDERS_PATH}/${encodeURIComponent(orderId)}`;
}

/** Orders with items the seller ships and hasn't yet, or every order. */
export const SELLER_ORDER_VIEWS = ['to-ship', 'all'] as const;
export type SellerOrderView = (typeof SELLER_ORDER_VIEWS)[number];

/** Live orders only, or test orders too. */
export const SELLER_ORDER_MODES = ['live', 'all'] as const;
export type SellerOrderModeFilter = (typeof SELLER_ORDER_MODES)[number];

export function isSellerOrderView(value: string): value is SellerOrderView {
	return (SELLER_ORDER_VIEWS as readonly string[]).includes(value);
}

export function isSellerOrderModeFilter(value: string): value is SellerOrderModeFilter {
	return (SELLER_ORDER_MODES as readonly string[]).includes(value);
}

export const SELLER_CARRIERS = ['usps', 'ups', 'fedex', 'dhl', 'other'] as const;
export type SellerCarrier = (typeof SELLER_CARRIERS)[number];
export const SELLER_CARRIER_NAMES: Readonly<Record<Exclude<SellerCarrier, 'other'>, string>> = { usps: 'USPS', ups: 'UPS', fedex: 'FedEx', dhl: 'DHL' };

/** An order in the seller's list. */
export interface SellerOrderRow {
	id: string;
	orderNumber: number;
	mode: StoreMode;
	appId: string;
	/** Null when the store's app was deleted. */
	storeTitle: string | null;
	createdAt: string;
	customerName: string | null;
	customerEmail: string | null;
	totalCents: number;
	paymentStatus: StorePaymentStatus;
	fulfillmentStatus: StoreFulfillmentStatus;
	units: number;
	/** Units of the seller's own products with no refund: what they ship. */
	ownUnits: number;
	/** Units of catalog items with no refund: what Estori ships. */
	catalogUnits: number;
}

export interface SellerOrdersData {
	orders: SellerOrderRow[];
	nextCursor: string | null;
	/** The stores the seller has orders in, for the store filter. */
	stores: { appId: string; title: string | null }[];
	/** The seller has test orders, so the page can say they're hidden. */
	hasTestOrders: boolean;
}

export interface SellerOrderLine {
	lineNo: number;
	name: string;
	kind: StoreLineKind;
	quantity: number;
	unitPriceCents: number;
	catalogVariantId: string | null;
	/** A refund was claimed or made for this line. */
	refunded: boolean;
}

export interface SellerOrderDetail extends Omit<StoreOrderSummary, 'items'> {
	appId: string;
	storeTitle: string | null;
	customerPhone: string | null;
	refundedCents: number;
	carrier: string | null;
	trackingNumber: string | null;
	shippedAt: string | null;
	/** The latest dispute, when the shopper disputed the payment. */
	dispute: { amountCents: number; status: string } | null;
	items: SellerOrderLine[];
}

export type SellerShipmentRequest =
	| { shipped: true; carrier: SellerCarrier | null; carrierName?: string; trackingNumber?: string | null }
	| { shipped: false };
```
`StoreOrderSummary` is declared earlier in the same file. `StoreLineKind`, `StoreMode`, `StorePaymentStatus` and `StoreFulfillmentStatus` already exist there.

Create `worker/database/services/keyset-cursor.ts`:
```ts
/** A page of a newest-first list ends at its last row's creation second and id, so rows created in the same second are neither skipped nor repeated. */

const CURSOR = /^(\d{1,12}):([A-Za-z0-9_-]{1,64})$/;

export function parseKeysetCursor(cursor: string): { createdAt: Date; id: string } | null {
    const match = CURSOR.exec(cursor);
    return match ? { createdAt: new Date(Number(match[1]) * 1000), id: match[2] } : null;
}

export function keysetCursorOf(createdAt: Date, id: string): string {
    return `${Math.floor(createdAt.getTime() / 1000)}:${id}`;
}
```
In `CatalogOrderAdminService.ts`:
- delete `CURSOR` and `parseCatalogOrdersCursor`;
- import `parseKeysetCursor` and `keysetCursorOf`;
- use `parseKeysetCursor(input.cursor)`;
- build `nextCursor` with `keysetCursorOf(last.createdAt, last.id)`.

In `worker/api/controllers/catalog/controller.ts`, import `parseKeysetCursor` from `../../../database/services/keyset-cursor` in place of `parseCatalogOrdersCursor`.

- [ ] **Step 4: Run the tests and the admin tests**

Run: `rtk proxy bunx vitest run worker/database/services/seller-orders.sql.test.ts shared/types/store-payments.test.ts worker/database/services/catalog-orders-admin.sql.test.ts worker/api/controllers/catalog/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/database/schema.ts migrations/0027_seller_order_shipments.sql migrations/meta shared/types/store-payments.ts shared/types/store-payments.test.ts worker/database/services/keyset-cursor.ts worker/database/services/CatalogOrderAdminService.ts worker/api/controllers/catalog/controller.ts worker/database/services/seller-orders.sql.test.ts
git commit -m "feat(orders): store orders record when they shipped, a seller's orders list from one index, and the seller order types"
```

### Task 2: The seller's order list

**Files:**
- Create: `worker/database/services/SellerOrderService.ts`
- Modify: `worker/database/index.ts` (export it)
- Test: `worker/database/services/seller-orders.sql.test.ts`

**Interfaces:**
- Consumes: Task 1's types and the `keyset-cursor` helpers.
- Produces: `SellerOrderService.listOrders(input: { sellerUserId: string; view: SellerOrderView; mode: SellerOrderModeFilter; appId?: string | null; cursor?: string | null; limit?: number }): Promise<SellerOrdersData>`. It throws `Error('Invalid cursor')` for a cursor it didn't make.

- [ ] **Step 1: Write the failing tests** (append to the SQL test file)

```ts
import { envWith, insertApp, insertUser } from '../test-support/real-d1';
import { SellerOrderService } from './SellerOrderService';

const NOW = new Date(1_800_000_000_000);
const HOUR = 60 * 60 * 1000;
const at = (hoursAgo: number) => Math.floor((NOW.getTime() - hoursAgo * HOUR) / 1000);
let numbers = 0;

/** A store order with these lines; each line is [kind, quantity, refunded?]. */
async function sale(order: { id: string; seller?: string; appId?: string; mode?: 'test' | 'live'; hoursAgo: number; payment?: string; shipped?: boolean; lines: Array<['own' | 'catalog', number, boolean?]> }) {
	numbers += 1;
	await db
		.prepare(
			`INSERT INTO store_orders (id, mode, app_id, order_number, checkout_id, seller_user_id, subtotal_cents, shipping_cents, total_cents, application_fee_cents, payment_status, fulfillment_status, customer_name, customer_email, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, 4000, 0, 4000, 400, ?, ?, 'Ana Ruiz', 'ana@example.test', ?, ?)`,
		)
		.bind(order.id, order.mode ?? 'live', order.appId ?? 'app_tea', numbers, `chk_${order.id}`, order.seller ?? 'seller_1', order.payment ?? 'paid', order.shipped ? 'fulfilled' : 'unfulfilled', at(order.hoursAgo), at(order.hoursAgo))
		.run();
	for (const [index, [kind, quantity, refunded]] of order.lines.entries()) {
		await db
			.prepare(`INSERT INTO store_order_items (order_id, line_no, kind, product_id, variant_id, name, quantity, unit_price_cents, catalog_variant_id) VALUES (?, ?, ?, 'p', 'v', ?, ?, 1000, ?)`)
			.bind(order.id, index + 1, kind, `Item ${index + 1}`, quantity, kind === 'catalog' ? `cv_${index + 1}` : null)
			.run();
		if (refunded) {
			await db
				.prepare(`INSERT INTO store_refunds (id, order_id, line_no, amount_cents, request_id, initiated_by, stripe_refund_id, created_at) VALUES (?, ?, ?, 1000, 'req', 'seller', 're_1', ?)`)
				.bind(`rf_${order.id}_${index + 1}`, order.id, index + 1, at(0))
				.run();
		}
	}
}

async function ids(input: Partial<Parameters<SellerOrderService['listOrders']>[0]> = {}): Promise<string[]> {
	const page = await new SellerOrderService(envWith(db)).listOrders({ sellerUserId: 'seller_1', view: 'to-ship', mode: 'live', ...input });
	return page.orders.map((order) => order.id);
}
```
Extend `beforeAll`:
```ts
	await insertUser(db, 'seller_1');
	await insertUser(db, 'seller_2');
	await insertApp(db, { id: 'app_tea', userId: 'seller_1', title: 'Northwind Tea' });
	await insertApp(db, { id: 'app_home', userId: 'seller_1', title: 'Lumen Home' });
```
Tests:
```ts
	it('lists to ship the paid orders with own items not yet shipped or refunded, newest first', async () => {
		await sale({ id: 'own', hoursAgo: 1, lines: [['own', 2]] });
		await sale({ id: 'mixed', hoursAgo: 2, payment: 'partially_refunded', lines: [['own', 1], ['catalog', 1, true]] });
		await sale({ id: 'catalog-only', hoursAgo: 3, lines: [['catalog', 1]] });
		await sale({ id: 'shipped', hoursAgo: 4, shipped: true, lines: [['own', 1]] });
		await sale({ id: 'own-refunded', hoursAgo: 5, payment: 'partially_refunded', lines: [['own', 1, true], ['catalog', 1]] });
		await sale({ id: 'refunded', hoursAgo: 6, payment: 'refunded', lines: [['own', 1]] });
		await sale({ id: 'disputed', hoursAgo: 7, payment: 'disputed', lines: [['own', 1]] });
		await sale({ id: 'theirs', seller: 'seller_2', hoursAgo: 0, lines: [['own', 1]] });
		expect(await ids()).toEqual(['own', 'mixed']);
		expect(await ids({ view: 'all' })).toEqual(['own', 'mixed', 'catalog-only', 'shipped', 'own-refunded', 'refunded', 'disputed']);
	});

	it('counts units, what the seller ships and what Estori ships, leaving refunded lines out', async () => {
		await sale({ id: 'mixed', hoursAgo: 1, lines: [['own', 2], ['own', 1, true], ['catalog', 3]] });
		const [row] = (await new SellerOrderService(envWith(db)).listOrders({ sellerUserId: 'seller_1', view: 'all', mode: 'live' })).orders;
		expect(row).toMatchObject({ id: 'mixed', storeTitle: 'Northwind Tea', units: 6, ownUnits: 2, catalogUnits: 3, customerName: 'Ana Ruiz', totalCents: 4000, paymentStatus: 'paid', fulfillmentStatus: 'unfulfilled' });
	});

	it('hides test orders unless asked, says the seller has some, and filters by store', async () => {
		await sale({ id: 'live-tea', hoursAgo: 1, lines: [['own', 1]] });
		await sale({ id: 'test-tea', mode: 'test', hoursAgo: 2, lines: [['own', 1]] });
		await sale({ id: 'live-home', appId: 'app_home', hoursAgo: 3, lines: [['own', 1]] });
		const service = new SellerOrderService(envWith(db));
		const live = await service.listOrders({ sellerUserId: 'seller_1', view: 'all', mode: 'live' });
		expect(live.orders.map((order) => order.id)).toEqual(['live-tea', 'live-home']);
		expect(live.hasTestOrders).toBe(true);
		expect(live.stores).toEqual(expect.arrayContaining([{ appId: 'app_tea', title: 'Northwind Tea' }, { appId: 'app_home', title: 'Lumen Home' }]));
		expect(await ids({ view: 'all', mode: 'all' })).toEqual(['live-tea', 'test-tea', 'live-home']);
		expect(await ids({ view: 'all', appId: 'app_home' })).toEqual(['live-home']);
	});

	it("names no store for an order whose store's app was deleted", async () => {
		await sale({ id: 'orphan', appId: 'app_gone', hoursAgo: 1, lines: [['own', 1]] });
		const [row] = (await new SellerOrderService(envWith(db)).listOrders({ sellerUserId: 'seller_1', view: 'all', mode: 'live' })).orders;
		expect(row).toMatchObject({ id: 'orphan', storeTitle: null });
	});

	it('pages through orders created in the same second without skipping or repeating one, and refuses a cursor it did not make', async () => {
		for (const id of ['a', 'b', 'c', 'd', 'e']) await sale({ id, hoursAgo: 1, lines: [['own', 1]] });
		const service = new SellerOrderService(envWith(db));
		const seen: string[] = [];
		let cursor: string | null = null;
		do {
			const page = await service.listOrders({ sellerUserId: 'seller_1', view: 'all', mode: 'live', cursor, limit: 2 });
			seen.push(...page.orders.map((order) => order.id));
			cursor = page.nextCursor;
		} while (cursor);
		expect(seen).toEqual(['e', 'd', 'c', 'b', 'a']);
		await expect(service.listOrders({ sellerUserId: 'seller_1', view: 'all', mode: 'live', cursor: 'garbage' })).rejects.toThrow('Invalid cursor');
	});
```

- [ ] **Step 2: Run them to see them fail**

Run: `rtk proxy bunx vitest run worker/database/services/seller-orders.sql.test.ts`
Expected: FAIL. `./SellerOrderService` can't be found.

- [ ] **Step 3: Implement** `worker/database/services/SellerOrderService.ts`:
```ts
/** A seller's own store orders: the Orders page's list and order facts, and marking an order shipped. Every query is scoped to the seller. */

import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { keysetCursorOf, parseKeysetCursor } from './keyset-cursor';
import type { SellerOrderModeFilter, SellerOrdersData, SellerOrderView } from '../../../shared/types/store-payments';

export const SELLER_ORDERS_PAGE = 50;

/** Units of this kind on the order with no refund claimed or made. */
function unrefundedUnits(kind: 'own' | 'catalog') {
    return sql<number>`(SELECT COALESCE(SUM(i.quantity), 0) FROM store_order_items i WHERE i.order_id = ${schema.storeOrders.id} AND i.kind = ${kind} AND NOT EXISTS (SELECT 1 FROM store_refunds r WHERE r.order_id = i.order_id AND r.line_no = i.line_no))`;
}

export class SellerOrderService extends BaseService {
    async listOrders(input: { sellerUserId: string; view: SellerOrderView; mode: SellerOrderModeFilter; appId?: string | null; cursor?: string | null; limit?: number }): Promise<SellerOrdersData> {
        const orders = schema.storeOrders;
        const limit = input.limit ?? SELLER_ORDERS_PAGE;
        const after = input.cursor ? parseKeysetCursor(input.cursor) : null;
        if (input.cursor && !after) throw new Error('Invalid cursor');
        const ownToShip = sql`EXISTS (SELECT 1 FROM store_order_items i WHERE i.order_id = ${orders.id} AND i.kind = 'own' AND NOT EXISTS (SELECT 1 FROM store_refunds r WHERE r.order_id = i.order_id AND r.line_no = i.line_no))`;

        const rows = await this.database
            .select({
                id: orders.id,
                orderNumber: orders.orderNumber,
                mode: orders.mode,
                appId: orders.appId,
                storeTitle: schema.apps.title,
                createdAt: orders.createdAt,
                customerName: orders.customerName,
                customerEmail: orders.customerEmail,
                totalCents: orders.totalCents,
                paymentStatus: orders.paymentStatus,
                fulfillmentStatus: orders.fulfillmentStatus,
                units: sql<number>`(SELECT COALESCE(SUM(quantity), 0) FROM store_order_items WHERE store_order_items.order_id = ${orders.id})`,
                ownUnits: unrefundedUnits('own'),
                catalogUnits: unrefundedUnits('catalog'),
            })
            .from(orders)
            .leftJoin(schema.apps, eq(schema.apps.id, orders.appId))
            .where(
                and(
                    eq(orders.sellerUserId, input.sellerUserId),
                    input.mode === 'live' ? eq(orders.mode, 'live') : undefined,
                    input.appId ? eq(orders.appId, input.appId) : undefined,
                    input.view === 'to-ship' ? and(inArray(orders.paymentStatus, ['paid', 'partially_refunded']), eq(orders.fulfillmentStatus, 'unfulfilled'), ownToShip) : undefined,
                    after ? or(lt(orders.createdAt, after.createdAt), and(eq(orders.createdAt, after.createdAt), lt(orders.id, after.id))) : undefined,
                ),
            )
            .orderBy(desc(orders.createdAt), desc(orders.id))
            .limit(limit + 1)
            .all();

        const page = rows.slice(0, limit);
        const last = page[page.length - 1];
        const [stores, testOrder] = await Promise.all([
            this.database
                .selectDistinct({ appId: orders.appId, title: schema.apps.title })
                .from(orders)
                .leftJoin(schema.apps, eq(schema.apps.id, orders.appId))
                .where(eq(orders.sellerUserId, input.sellerUserId))
                .all(),
            this.database
                .select({ id: orders.id })
                .from(orders)
                .where(and(eq(orders.sellerUserId, input.sellerUserId), eq(orders.mode, 'test')))
                .limit(1)
                .get(),
        ]);
        return {
            orders: page.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), units: Number(row.units), ownUnits: Number(row.ownUnits), catalogUnits: Number(row.catalogUnits) })),
            nextCursor: rows.length > limit && last ? keysetCursorOf(last.createdAt, last.id) : null,
            stores,
            hasTestOrders: Boolean(testOrder),
        };
    }
}
```
In `worker/database/index.ts`, add `export { SellerOrderService } from './services/SellerOrderService';`.

- [ ] **Step 4: Run the tests**

Run: `rtk proxy bunx vitest run worker/database/services/seller-orders.sql.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/database/services/SellerOrderService.ts worker/database/index.ts worker/database/services/seller-orders.sql.test.ts
git commit -m "feat(orders): a seller lists their orders across stores, to ship first, with test orders and other sellers left out"
```

### Task 3: Order facts and marking an order shipped

**Files:**
- Modify: `worker/database/services/SellerOrderService.ts`
- Test: `worker/database/services/seller-orders.sql.test.ts`

**Interfaces:**
- Produces:
  - `SellerOrderService.orderFacts(sellerUserId: string, orderId: string): Promise<SellerOrderFacts | null>`, where `SellerOrderFacts` is `{ storeTitle: string | null; carrier: string | null; trackingNumber: string | null; shippedAt: Date | null; refundedLineNos: number[]; dispute: { amountCents: number; status: string } | null }`.
  - `SellerOrderService.setShipment(input: { sellerUserId: string; orderId: string; shipment: { carrier: string | null; trackingNumber: string | null } | null; now: Date }): Promise<ShipmentResult>`, where `ShipmentResult` is `'updated' | 'not-found' | 'no-own-items' | 'nothing-to-ship' | 'refunded'`.
  - `SellerOrderService.newOrderEmailFacts(orderId: string): Promise<{ storeTitle: string | null; sellerEmail: string | null } | null>`.

- [ ] **Step 1: Write the failing tests** (append)

```ts
	it("reads an order's shipment, refunded lines, latest dispute and store, for its seller only", async () => {
		await sale({ id: 'facts', hoursAgo: 1, payment: 'disputed', lines: [['own', 1, true], ['own', 1]] });
		await db.prepare(`INSERT INTO store_disputes (id, order_id, amount_cents, reason, status, created_at, updated_at) VALUES ('dp_old', 'facts', 500, 'fraudulent', 'won', ?, ?), ('dp_new', 'facts', 4000, 'fraudulent', 'needs_response', ?, ?)`).bind(at(5), at(5), at(1), at(1)).run();
		const service = new SellerOrderService(envWith(db));
		expect(await service.orderFacts('seller_1', 'facts')).toEqual({ storeTitle: 'Northwind Tea', carrier: null, trackingNumber: null, shippedAt: null, refundedLineNos: [1], dispute: { amountCents: 4000, status: 'needs_response' } });
		expect(await service.orderFacts('seller_2', 'facts')).toBeNull();
	});

	it('marks an order shipped, keeps the first shipped date on an edit, and marks it not shipped again', async () => {
		await sale({ id: 'ship', hoursAgo: 1, lines: [['own', 1], ['catalog', 1]] });
		const service = new SellerOrderService(envWith(db));
		expect(await service.setShipment({ sellerUserId: 'seller_1', orderId: 'ship', shipment: { carrier: 'USPS', trackingNumber: '9400 1000' }, now: NOW })).toBe('updated');
		expect(await service.setShipment({ sellerUserId: 'seller_1', orderId: 'ship', shipment: { carrier: 'UPS', trackingNumber: '1Z999' }, now: new Date(NOW.getTime() + HOUR) })).toBe('updated');
		expect(await service.orderFacts('seller_1', 'ship')).toMatchObject({ carrier: 'UPS', trackingNumber: '1Z999', shippedAt: new Date(Math.floor(NOW.getTime() / 1000) * 1000) });
		expect(await db.prepare("SELECT fulfillment_status AS status FROM store_orders WHERE id = 'ship'").first()).toEqual({ status: 'fulfilled' });
		expect(await service.setShipment({ sellerUserId: 'seller_1', orderId: 'ship', shipment: null, now: NOW })).toBe('updated');
		expect(await service.orderFacts('seller_1', 'ship')).toMatchObject({ carrier: null, trackingNumber: null, shippedAt: null });
		expect(await db.prepare("SELECT fulfillment_status AS status FROM store_orders WHERE id = 'ship'").first()).toEqual({ status: 'unfulfilled' });
	});

	it("refuses to ship another seller's order, one Estori ships whole, one whose own items were refunded, and a refunded one", async () => {
		await sale({ id: 'catalog-only', hoursAgo: 1, lines: [['catalog', 1]] });
		await sale({ id: 'own-refunded', hoursAgo: 2, payment: 'partially_refunded', lines: [['own', 1, true], ['catalog', 1]] });
		await sale({ id: 'refunded', hoursAgo: 3, payment: 'refunded', lines: [['own', 1]] });
		const service = new SellerOrderService(envWith(db));
		const ship = (orderId: string, sellerUserId = 'seller_1') => service.setShipment({ sellerUserId, orderId, shipment: { carrier: null, trackingNumber: null }, now: NOW });
		expect(await ship('catalog-only', 'seller_2')).toBe('not-found');
		expect(await ship('catalog-only')).toBe('no-own-items');
		expect(await ship('own-refunded')).toBe('nothing-to-ship');
		expect(await ship('refunded')).toBe('refunded');
	});

	it("finds a new order's store name and its seller's email for the email", async () => {
		await sale({ id: 'new', hoursAgo: 0, lines: [['own', 1]] });
		expect(await new SellerOrderService(envWith(db)).newOrderEmailFacts('new')).toEqual({ storeTitle: 'Northwind Tea', sellerEmail: 'seller_1@example.test' });
		expect(await new SellerOrderService(envWith(db)).newOrderEmailFacts('missing')).toBeNull();
	});
```

- [ ] **Step 2: Run them to see them fail**

Run: `rtk proxy bunx vitest run worker/database/services/seller-orders.sql.test.ts`
Expected: FAIL. `orderFacts`, `setShipment` and `newOrderEmailFacts` aren't functions.

- [ ] **Step 3: Implement.** Add these to the `SellerOrderService` class, with `asc` added to the imports:

```ts
    async orderFacts(sellerUserId: string, orderId: string): Promise<SellerOrderFacts | null> {
        const orders = schema.storeOrders;
        const row = await this.database
            .select({ storeTitle: schema.apps.title, carrier: orders.carrier, trackingNumber: orders.trackingNumber, shippedAt: orders.shippedAt })
            .from(orders)
            .leftJoin(schema.apps, eq(schema.apps.id, orders.appId))
            .where(and(eq(orders.id, orderId), eq(orders.sellerUserId, sellerUserId)))
            .get();
        if (!row) return null;
        const [refunds, dispute] = await Promise.all([
            this.database.select({ lineNo: schema.storeRefunds.lineNo }).from(schema.storeRefunds).where(eq(schema.storeRefunds.orderId, orderId)).orderBy(asc(schema.storeRefunds.lineNo)).all(),
            this.database
                .select({ amountCents: schema.storeDisputes.amountCents, status: schema.storeDisputes.status })
                .from(schema.storeDisputes)
                .where(eq(schema.storeDisputes.orderId, orderId))
                .orderBy(desc(schema.storeDisputes.createdAt))
                .limit(1)
                .get(),
        ]);
        return { ...row, refundedLineNos: refunds.map((refund) => refund.lineNo), dispute: dispute ?? null };
    }

    /** Marks the order's own items shipped, or not shipped again with `shipment: null`. An edit keeps the first shipped date. */
    async setShipment(input: { sellerUserId: string; orderId: string; shipment: { carrier: string | null; trackingNumber: string | null } | null; now: Date }): Promise<ShipmentResult> {
        const orders = schema.storeOrders;
        const order = await this.database
            .select({ paymentStatus: orders.paymentStatus, shippedAt: orders.shippedAt })
            .from(orders)
            .where(and(eq(orders.id, input.orderId), eq(orders.sellerUserId, input.sellerUserId)))
            .get();
        if (!order) return 'not-found';
        const ownLines = await this.database
            .select({ lineNo: schema.storeOrderItems.lineNo })
            .from(schema.storeOrderItems)
            .where(and(eq(schema.storeOrderItems.orderId, input.orderId), eq(schema.storeOrderItems.kind, 'own')))
            .all();
        if (ownLines.length === 0) return 'no-own-items';
        const touch = { revision: sql`${orders.revision} + 1`, updatedAt: input.now };
        if (!input.shipment) {
            await this.database.update(orders).set({ fulfillmentStatus: 'unfulfilled', carrier: null, trackingNumber: null, shippedAt: null, ...touch }).where(eq(orders.id, input.orderId)).run();
            return 'updated';
        }
        if (order.paymentStatus === 'refunded') return 'refunded';
        const refunded = new Set((await this.database.select({ lineNo: schema.storeRefunds.lineNo }).from(schema.storeRefunds).where(eq(schema.storeRefunds.orderId, input.orderId)).all()).map((row) => row.lineNo));
        if (ownLines.every((line) => refunded.has(line.lineNo))) return 'nothing-to-ship';
        await this.database
            .update(orders)
            .set({ fulfillmentStatus: 'fulfilled', carrier: input.shipment.carrier, trackingNumber: input.shipment.trackingNumber, shippedAt: order.shippedAt ?? input.now, ...touch })
            .where(eq(orders.id, input.orderId))
            .run();
        return 'updated';
    }

    async newOrderEmailFacts(orderId: string): Promise<{ storeTitle: string | null; sellerEmail: string | null } | null> {
        const row = await this.database
            .select({ storeTitle: schema.apps.title, sellerEmail: schema.users.email })
            .from(schema.storeOrders)
            .leftJoin(schema.apps, eq(schema.apps.id, schema.storeOrders.appId))
            .leftJoin(schema.users, eq(schema.users.id, schema.storeOrders.sellerUserId))
            .where(eq(schema.storeOrders.id, orderId))
            .get();
        return row ?? null;
    }
```
Above the class:
```ts
export interface SellerOrderFacts {
    storeTitle: string | null;
    carrier: string | null;
    trackingNumber: string | null;
    shippedAt: Date | null;
    refundedLineNos: number[];
    dispute: { amountCents: number; status: string } | null;
}

export type ShipmentResult = 'updated' | 'not-found' | 'no-own-items' | 'nothing-to-ship' | 'refunded';
```

- [ ] **Step 4: Run the tests**

Run: `rtk proxy bunx vitest run worker/database/services/seller-orders.sql.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/database/services/SellerOrderService.ts worker/database/services/seller-orders.sql.test.ts
git commit -m "feat(orders): a seller marks an order shipped or not, and reads its refunds, dispute and shipment"
```

### Task 4: The seller orders API

**Files:**
- Modify: `worker/services/store-payments/request.ts` (export `hasControlCharacter`)
- Create: `worker/api/controllers/sellerOrders/shipment-request.ts` and `shipment-request.test.ts`
- Create: `worker/api/controllers/sellerOrders/order-detail.ts` and `order-detail.test.ts`
- Create: `worker/api/controllers/sellerOrders/controller.ts` and `controller.sql.test.ts`
- Create: `worker/api/routes/sellerOrderRoutes.ts` and `seller-order-routes.test.ts`
- Modify: `worker/api/routes/index.ts`

**Interfaces:**
- Consumes: `SellerOrderService` (Tasks 2 and 3), `StoreOrderService.getOrder`, `CatalogOrderService.progressForSessions` and `orderSummary` (`worker/api/controllers/stores/order-summary.ts`).
- Produces:
  - `parseSellerShipmentRequest(body: unknown): ParsedShipment | null`, where `ParsedShipment` is `{ shipped: true; carrier: string | null; trackingNumber: string | null } | { shipped: false }`;
  - `sellerOrderDetail(order: StoreOrderView, facts: SellerOrderFacts, catalogItems: CatalogItemProgress[]): SellerOrderDetail`;
  - routes `GET /api/orders`, `GET /api/orders/:id` and `POST /api/orders/:id/shipment`.

- [ ] **Step 1: Write the failing tests**

`shipment-request.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseSellerShipmentRequest } from './shipment-request';

describe('a shipment request', () => {
	it('names a known carrier by its display name, keeps a typed one for Other, and trims the tracking number', () => {
		expect(parseSellerShipmentRequest({ shipped: true, carrier: 'usps', trackingNumber: ' 9400 1000-22 ' })).toEqual({ shipped: true, carrier: 'USPS', trackingNumber: '9400 1000-22' });
		expect(parseSellerShipmentRequest({ shipped: true, carrier: 'other', carrierName: ' Canada Post ' })).toEqual({ shipped: true, carrier: 'Canada Post', trackingNumber: null });
		expect(parseSellerShipmentRequest({ shipped: true, carrier: null, trackingNumber: '' })).toEqual({ shipped: true, carrier: null, trackingNumber: null });
		expect(parseSellerShipmentRequest({ shipped: false })).toEqual({ shipped: false });
	});

	it('refuses unknown carriers, Other without a name, long or odd tracking numbers and control characters', () => {
		for (const body of [null, {}, { shipped: 'yes' }, { shipped: true, carrier: 'pigeon' }, { shipped: true, carrier: 'other' }, { shipped: true, carrier: 'other', carrierName: 'x'.repeat(41) }, { shipped: true, carrier: 'other', carrierName: 'Post\u0007' }, { shipped: true, carrier: null, trackingNumber: 'x'.repeat(65) }, { shipped: true, carrier: null, trackingNumber: '<script>' }]) {
			expect(parseSellerShipmentRequest(body), JSON.stringify(body)).toBeNull();
		}
	});
});
```
`order-detail.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { sellerOrderDetail } from './order-detail';
import type { StoreOrderView } from '../../../services/store-payments/store';

const ORDER: StoreOrderView = {
	id: 'ord_1', orderNumber: 7, mode: 'live', appId: 'app_tea', paymentStatus: 'paid', fulfillmentStatus: 'fulfilled',
	subtotalCents: 3000, shippingCents: 0, totalCents: 3000, applicationFeeCents: 300, currency: 'usd',
	customerEmail: 'ana@example.test', customerName: 'Ana Ruiz',
	shippingAddress: { name: 'Ana Ruiz', line1: '12 Elm St', line2: null, city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US', phone: '+15125550100', email: null },
	note: 'Gift', needsAttention: null, stripeCheckoutSessionId: 'cs_1', stripePaymentIntentId: 'pi_1', sellerUserId: 'seller_1', sellerStripeAccountId: 'acct_1', refundedCents: 1000, createdAt: new Date(0),
	items: [
		{ lineNo: 1, kind: 'own', productId: 'tea', variantId: 'tea-50', name: 'Oolong', quantity: 2, unitPriceCents: 1000, catalogVariantId: null, lockedCatalogPriceCents: null },
		{ lineNo: 2, kind: 'catalog', productId: 'feeder', variantId: 'feeder-1', name: 'Feeder', quantity: 1, unitPriceCents: 1000, catalogVariantId: 'cv_1', lockedCatalogPriceCents: 500 },
	],
};

describe('an order for its seller', () => {
	it('adds the store, phone, shipment, refunds, dispute and per-line refunds to the order summary', () => {
		const detail = sellerOrderDetail(ORDER, { storeTitle: 'Northwind Tea', carrier: 'USPS', trackingNumber: '9400', shippedAt: new Date(1000), refundedLineNos: [2], dispute: null }, []);
		expect(detail).toMatchObject({ id: 'ord_1', appId: 'app_tea', storeTitle: 'Northwind Tea', customerPhone: '+15125550100', refundedCents: 1000, carrier: 'USPS', trackingNumber: '9400', shippedAt: new Date(1000).toISOString(), dispute: null, note: 'Gift' });
		expect(detail.items).toEqual([
			{ lineNo: 1, name: 'Oolong', kind: 'own', quantity: 2, unitPriceCents: 1000, catalogVariantId: null, refunded: false },
			{ lineNo: 2, name: 'Feeder', kind: 'catalog', quantity: 1, unitPriceCents: 1000, catalogVariantId: 'cv_1', refunded: true },
		]);
	});
});
```
`controller.sql.test.ts`:
```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertApp, insertUser, migratedD1 } from '../../../database/test-support/real-d1';
import { SellerOrdersController } from './controller';
import type { RouteContext } from '../../types/route-context';

let db: D1Database;
beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'seller_1');
	await insertUser(db, 'seller_2');
	await insertApp(db, { id: 'app_tea', userId: 'seller_1', title: 'Northwind Tea' });
	const at = Math.floor(Date.now() / 1000);
	await db
		.prepare(`INSERT INTO store_orders (id, mode, app_id, order_number, checkout_id, seller_user_id, subtotal_cents, shipping_cents, total_cents, application_fee_cents, created_at, updated_at) VALUES ('ord_1', 'live', 'app_tea', 1, 'chk_1', 'seller_1', 2000, 0, 2000, 200, ?, ?)`)
		.bind(at, at)
		.run();
	await db.prepare(`INSERT INTO store_order_items (order_id, line_no, kind, product_id, variant_id, name, quantity, unit_price_cents) VALUES ('ord_1', 1, 'own', 'tea', 'tea-50', 'Oolong', 2, 1000)`).run();
});

const as = (userId: string, pathParams: Record<string, string> = {}) => ({ user: { id: userId }, pathParams }) as unknown as RouteContext;
const json = async (response: Response) => ({ status: response.status, body: (await response.json()) as { data?: Record<string, unknown>; error?: unknown } });

describe('the seller orders API', () => {
	it('lists the signed-in seller orders to ship, and refuses a view, mode or cursor it does not know', async () => {
		const list = (query: string) => SellerOrdersController.list(new Request(`https://estori.app/api/orders${query}`), envWith(db), {} as ExecutionContext, as('seller_1'));
		expect((await json(await list(''))).body.data).toMatchObject({ orders: [{ id: 'ord_1', ownUnits: 2 }] });
		for (const query of ['?view=late', '?mode=test', '?cursor=garbage']) expect((await list(query)).status, query).toBe(400);
	});

	it("answers one order to its seller and not found to anyone else", async () => {
		const detail = (userId: string) => SellerOrdersController.detail(new Request('https://estori.app/api/orders/ord_1'), envWith(db), {} as ExecutionContext, as(userId, { id: 'ord_1' }));
		expect((await json(await detail('seller_1'))).body.data).toMatchObject({ id: 'ord_1', storeTitle: 'Northwind Tea', items: [{ lineNo: 1, refunded: false }] });
		expect((await detail('seller_2')).status).toBe(404);
	});

	it('marks the order shipped and answers it, refuses a bad body, and refuses an order with nothing the seller ships', async () => {
		const ship = (body: unknown, orderId = 'ord_1') =>
			SellerOrdersController.shipment(new Request(`https://estori.app/api/orders/${orderId}/shipment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), envWith(db), {} as ExecutionContext, as('seller_1', { id: orderId }));
		const shipped = await json(await ship({ shipped: true, carrier: 'ups', trackingNumber: '1Z999' }));
		expect(shipped.body.data).toMatchObject({ id: 'ord_1', fulfillmentStatus: 'fulfilled', carrier: 'UPS', trackingNumber: '1Z999' });
		expect((await ship({ shipped: true, carrier: 'pigeon' })).status).toBe(400);
		expect((await ship({ shipped: true, carrier: null }, 'missing')).status).toBe(404);
		await db.prepare(`UPDATE store_order_items SET kind = 'catalog', catalog_variant_id = 'cv_1' WHERE order_id = 'ord_1'`).run();
		expect((await ship({ shipped: true, carrier: null })).status).toBe(409);
	});
});
```
`seller-order-routes.test.ts`:
```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/routes/sellerOrderRoutes.ts', '/worker/api/routes/index.ts'], { query: '?raw', import: 'default', eager: true });

describe('seller order routes', () => {
	it("serve signed-in sellers their own orders, and are registered", () => {
		const routes = (sources['/worker/api/routes/sellerOrderRoutes.ts'] ?? '').split('\n');
		for (const route of ["app.get('/api/orders',", "app.get('/api/orders/:id',", "app.post('/api/orders/:id/shipment',"]) {
			expect(routes.find((line) => line.includes(route)), route).toContain('setAuthLevel(AuthConfig.authenticated)');
		}
		expect(sources['/worker/api/routes/index.ts']).toContain('setupSellerOrderRoutes(app)');
	});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `rtk proxy bunx vitest run worker/api/controllers/sellerOrders worker/api/routes/seller-order-routes.test.ts`
Expected: FAIL. The modules don't exist yet.

- [ ] **Step 3: Implement**

In `request.ts`, change `function hasControlCharacter(` to `export function hasControlCharacter(`.

`shipment-request.ts`:
```ts
/** A seller's shipment as the API takes it: a known carrier or a typed one, and an optional tracking number. Pure. */

import { SELLER_CARRIER_NAMES, SELLER_CARRIERS, type SellerCarrier } from '../../../../shared/types/store-payments';
import { hasControlCharacter } from '../../../services/store-payments/request';

export type ParsedShipment = { shipped: true; carrier: string | null; trackingNumber: string | null } | { shipped: false };

const TRACKING = /^[A-Za-z0-9 -]{1,64}$/;
const CARRIER_NAME_MAX = 40;

function isCarrier(value: unknown): value is SellerCarrier {
	return typeof value === 'string' && (SELLER_CARRIERS as readonly string[]).includes(value);
}

export function parseSellerShipmentRequest(body: unknown): ParsedShipment | null {
	if (!body || typeof body !== 'object') return null;
	const { shipped, carrier, carrierName, trackingNumber } = body as Record<string, unknown>;
	if (shipped === false) return { shipped: false };
	if (shipped !== true) return null;
	if (carrier !== null && carrier !== undefined && !isCarrier(carrier)) return null;
	let carrierText: string | null = null;
	if (carrier === 'other') {
		const name = typeof carrierName === 'string' ? carrierName.trim() : '';
		if (!name || name.length > CARRIER_NAME_MAX || hasControlCharacter(name)) return null;
		carrierText = name;
	} else if (isCarrier(carrier)) {
		carrierText = SELLER_CARRIER_NAMES[carrier];
	}
	if (trackingNumber !== undefined && trackingNumber !== null && typeof trackingNumber !== 'string') return null;
	const tracking = typeof trackingNumber === 'string' ? trackingNumber.trim() : '';
	if (tracking && !TRACKING.test(tracking)) return null;
	return { shipped: true, carrier: carrierText, trackingNumber: tracking || null };
}
```
In `isCarrier(carrier)` after the `'other'` branch, `carrier` narrows to the four named carriers. If TypeScript doesn't narrow the indexed type, add a cast to `Exclude<SellerCarrier, 'other'>`.

`order-detail.ts`:
```ts
/** A store order as its seller sees it on the Orders page. Pure. */

import type { CatalogItemProgress, SellerOrderDetail } from '../../../../shared/types/store-payments';
import type { SellerOrderFacts } from '../../../database/services/SellerOrderService';
import type { StoreOrderView } from '../../../services/store-payments/store';
import { orderSummary } from '../stores/order-summary';

export function sellerOrderDetail(order: StoreOrderView, facts: SellerOrderFacts, catalogItems: CatalogItemProgress[]): SellerOrderDetail {
	const refunded = new Set(facts.refundedLineNos);
	const { items: _items, ...summary } = orderSummary(order, catalogItems);
	return {
		...summary,
		appId: order.appId,
		storeTitle: facts.storeTitle,
		customerPhone: order.shippingAddress?.phone ?? null,
		refundedCents: order.refundedCents,
		carrier: facts.carrier,
		trackingNumber: facts.trackingNumber,
		shippedAt: facts.shippedAt?.toISOString() ?? null,
		dispute: facts.dispute,
		items: order.items.map((item) => ({ lineNo: item.lineNo, name: item.name, kind: item.kind, quantity: item.quantity, unitPriceCents: item.unitPriceCents, catalogVariantId: item.catalogVariantId, refunded: refunded.has(item.lineNo) })),
	};
}
```
`controller.ts`:
```ts
/** The signed-in seller's orders across their stores: the list, one order, and marking it shipped. */

import { BaseController } from '../baseController';
import type { RouteContext } from '../../types/route-context';
import type { ApiResponse, ControllerResponse } from '../types';
import { CatalogOrderService, SellerOrderService, StoreOrderService } from '../../../database';
import { parseKeysetCursor } from '../../../database/services/keyset-cursor';
import { isSellerOrderModeFilter, isSellerOrderView, type SellerOrderDetail, type SellerOrdersData } from '../../../../shared/types/store-payments';
import { parseSellerShipmentRequest } from './shipment-request';
import { sellerOrderDetail } from './order-detail';

const SHIPMENT_REFUSALS = {
    'no-own-items': 'Estori ships everything in this order.',
    'nothing-to-ship': 'Every item you ship in this order was refunded.',
    refunded: 'This order was refunded.',
} as const;

export class SellerOrdersController extends BaseController {
    static async list(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<SellerOrdersData>>> {
        const params = new URL(request.url).searchParams;
        const view = params.get('view') ?? 'to-ship';
        const mode = params.get('mode') ?? 'live';
        const cursor = params.get('cursor');
        if (!isSellerOrderView(view) || !isSellerOrderModeFilter(mode)) return SellerOrdersController.createErrorResponse('Unknown view or mode', 400);
        if (cursor && !parseKeysetCursor(cursor)) return SellerOrdersController.createErrorResponse('Invalid cursor', 400);
        try {
            const data = await new SellerOrderService(env).listOrders({ sellerUserId: context.user!.id, view, mode, appId: params.get('store'), cursor });
            return SellerOrdersController.createSuccessResponse(data);
        } catch (error) {
            return SellerOrdersController.handleError(error, 'list orders') as ControllerResponse<ApiResponse<SellerOrdersData>>;
        }
    }

    static async detail(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<SellerOrderDetail>>> {
        const orderId = context.pathParams.id;
        if (!orderId) return SellerOrdersController.createErrorResponse('Missing order id', 400);
        try {
            const detail = await SellerOrdersController.detailOf(env, context.user!.id, orderId);
            return detail ? SellerOrdersController.createSuccessResponse(detail) : SellerOrdersController.createErrorResponse('Order not found', 404);
        } catch (error) {
            return SellerOrdersController.handleError(error, 'read an order') as ControllerResponse<ApiResponse<SellerOrderDetail>>;
        }
    }

    static async shipment(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<SellerOrderDetail>>> {
        const orderId = context.pathParams.id;
        const body = await SellerOrdersController.parseJsonBody<unknown>(request);
        const shipment = body.success ? parseSellerShipmentRequest(body.data) : null;
        if (!orderId || !shipment) return SellerOrdersController.createErrorResponse('Send shipped, and a known carrier and tracking number', 400);
        try {
            const sellerUserId = context.user!.id;
            const result = await new SellerOrderService(env).setShipment({
                sellerUserId,
                orderId,
                shipment: shipment.shipped ? { carrier: shipment.carrier, trackingNumber: shipment.trackingNumber } : null,
                now: new Date(),
            });
            if (result === 'not-found') return SellerOrdersController.createErrorResponse('Order not found', 404);
            if (result !== 'updated') return SellerOrdersController.createErrorResponse(SHIPMENT_REFUSALS[result], 409);
            const detail = await SellerOrdersController.detailOf(env, sellerUserId, orderId);
            return detail ? SellerOrdersController.createSuccessResponse(detail) : SellerOrdersController.createErrorResponse('Order not found', 404);
        } catch (error) {
            return SellerOrdersController.handleError(error, 'update a shipment') as ControllerResponse<ApiResponse<SellerOrderDetail>>;
        }
    }

    private static async detailOf(env: Env, sellerUserId: string, orderId: string): Promise<SellerOrderDetail | null> {
        const order = await new StoreOrderService(env).getOrder(orderId);
        if (!order || order.sellerUserId !== sellerUserId) return null;
        const facts = await new SellerOrderService(env).orderFacts(sellerUserId, orderId);
        if (!facts) return null;
        const progress = order.stripeCheckoutSessionId ? await new CatalogOrderService(env).progressForSessions([order.stripeCheckoutSessionId]) : new Map();
        return sellerOrderDetail(order, facts, (order.stripeCheckoutSessionId && progress.get(order.stripeCheckoutSessionId)) || []);
    }
}
```
`sellerOrderRoutes.ts`:
```ts
import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { SellerOrdersController } from '../controllers/sellerOrders/controller';

/** The signed-in seller's orders across their stores; each controller scopes its reads and writes to that seller. */
export function setupSellerOrderRoutes(app: Hono<AppEnv>): void {
    app.get('/api/orders', setAuthLevel(AuthConfig.authenticated), adaptController(SellerOrdersController, SellerOrdersController.list));
    app.get('/api/orders/:id', setAuthLevel(AuthConfig.authenticated), adaptController(SellerOrdersController, SellerOrdersController.detail));
    app.post('/api/orders/:id/shipment', setAuthLevel(AuthConfig.authenticated), adaptController(SellerOrdersController, SellerOrdersController.shipment));
}
```
In `routes/index.ts`, import it and call `setupSellerOrderRoutes(app);` next to `setupStoreRoutes(app);`.

- [ ] **Step 4: Run the tests**

Run: `rtk proxy bunx vitest run worker/api/controllers/sellerOrders worker/api/routes/seller-order-routes.test.ts worker/services/store-payments/request.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/services/store-payments/request.ts worker/api/controllers/sellerOrders worker/api/routes/sellerOrderRoutes.ts worker/api/routes/seller-order-routes.test.ts worker/api/routes/index.ts
git commit -m "feat(orders): the signed-in seller lists their orders, reads one and marks it shipped through the orders API"
```

### Task 5: The new-order email

**Files:**
- Modify: `worker/services/email/templates.ts` (adds `sellerNewOrderEmail` and `NewOrderEmailInput`)
- Create: `worker/services/store-payments/order-emails.ts` and `order-emails.test.ts`
- Modify: `worker/services/store-payments/fulfill.ts`, `fulfill.test.ts` and `wiring.ts`

**Interfaces:**
- Consumes: `SellerOrderService.newOrderEmailFacts` (Task 3), `StoreOrderService.getOrder`, `configuredBaseUrl(env)` (`worker/services/email/links.ts`), `createEmailSender(env)` and `sellerOrderPath` (Task 1).
- Produces:
  - `sellerNewOrderEmail(to: string, input: NewOrderEmailInput): OutgoingEmail`;
  - `NEW_ORDER_EMAILS_PER_DAY = 100`;
  - `notifySellerOfNewOrder(deps: NewOrderEmailDeps, orderId: string): Promise<'sent' | 'capped' | 'not-sent'>`;
  - `newOrderNotifierFromEnv(env: Env): (orderId: string) => Promise<void>`;
  - `RecordStoreOrderDeps.notifyNewOrder(orderId: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

`order-emails.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { NEW_ORDER_EMAILS_PER_DAY, notifySellerOfNewOrder, type NewOrderEmailDeps } from './order-emails';
import type { OutgoingEmail } from '../email/types';
import type { StoreOrderView } from './store';

const ORDER: StoreOrderView = {
	id: 'ord_1', orderNumber: 1042, mode: 'live', appId: 'app_tea', paymentStatus: 'paid', fulfillmentStatus: 'unfulfilled',
	subtotalCents: 4599, shippingCents: 0, totalCents: 4599, applicationFeeCents: 460, currency: 'usd',
	customerEmail: 'ana@example.test', customerName: 'Ana Ruiz',
	shippingAddress: { name: 'Ana Ruiz', line1: '12 Elm St', line2: null, city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US', phone: null, email: null },
	note: 'Happy birthday,\n<b>Mom</b>!', needsAttention: null, stripeCheckoutSessionId: 'cs_1', stripePaymentIntentId: 'pi_1', sellerUserId: 'seller_1', sellerStripeAccountId: 'acct_1', refundedCents: 0, createdAt: new Date(0),
	items: [
		{ lineNo: 1, kind: 'own', productId: 'tea', variantId: 'tea-100', name: 'Oolong, 100 g', quantity: 2, unitPriceCents: 1500, catalogVariantId: null, lockedCatalogPriceCents: null },
		{ lineNo: 2, kind: 'catalog', productId: 'pot', variantId: 'pot-1', name: 'Glass teapot', quantity: 1, unitPriceCents: 1599, catalogVariantId: 'cv_1', lockedCatalogPriceCents: 800 },
	],
};

function world(input: { order?: StoreOrderView; sellerEmail?: string | null; storeTitle?: string | null; now?: Date; sentToday?: number } = {}) {
	const kv = new Map<string, { value: string; ttl: number }>();
	const now = input.now ?? new Date('2026-10-18T23:59:00Z');
	if (input.sentToday) kv.set(`seller-order-emails:seller_1:${now.toISOString().slice(0, 10)}`, { value: String(input.sentToday), ttl: 0 });
	const sent: OutgoingEmail[] = [];
	const deps: NewOrderEmailDeps = {
		order: async () => input.order ?? ORDER,
		facts: async () => ({ storeTitle: input.storeTitle === undefined ? 'Northwind Tea' : input.storeTitle, sellerEmail: input.sellerEmail === undefined ? 'seller@example.test' : input.sellerEmail }),
		sender: { send: async (email) => void sent.push(email) },
		counter: { get: async (key) => kv.get(key)?.value ?? null, put: async (key, value, options) => void kv.set(key, { value, ttl: options.expirationTtl }) },
		baseUrl: 'https://estori.app',
		now: () => now,
	};
	return { deps, sent, kv };
}

describe('the new-order email', () => {
	it('tells the seller what was sold, their share, where it ships, the note, and what to ship themselves', async () => {
		const { deps, sent } = world();
		expect(await notifySellerOfNewOrder(deps, 'ord_1')).toBe('sent');
		const [email] = sent;
		expect(email.to).toBe('seller@example.test');
		expect(email.subject).toBe('New order #1042 at Northwind Tea: $45.99');
		expect(email.text).toContain('2 × Oolong, 100 g');
		expect(email.text).toContain('1 × Glass teapot');
		expect(email.text).toContain('Your share: $41.39');
		expect(email.text).toContain('Ship to: Ana Ruiz, Austin, TX, US');
		expect(email.text).not.toContain('12 Elm St');
		expect(email.text).toContain('Ship these items: Oolong, 100 g.');
		expect(email.text).toContain("Estori ships Glass teapot. You don't need to do anything for these.");
		expect(email.text).toContain('Open the order: https://estori.app/orders/ord_1');
		expect(email.html).toContain('Happy birthday,\n&lt;b&gt;Mom&lt;/b&gt;!');
	});

	it('marks a test order and says nothing ships', async () => {
		const { deps, sent } = world({ order: { ...ORDER, mode: 'test' } });
		await notifySellerOfNewOrder(deps, 'ord_1');
		expect(sent[0].subject).toBe('[Test] New order #1042 at Northwind Tea: $45.99');
		expect(sent[0].text).toContain('This was a test order. No money was charged and nothing ships.');
	});

	it('names "your store" when the store is gone, and sends nothing to a seller without an email', async () => {
		const gone = world({ storeTitle: null });
		await notifySellerOfNewOrder(gone.deps, 'ord_1');
		expect(gone.sent[0].subject).toBe('New order #1042 at your store: $45.99');
		const noEmail = world({ sellerEmail: null });
		expect(await notifySellerOfNewOrder(noEmail.deps, 'ord_1')).toBe('not-sent');
		expect(noEmail.sent).toHaveLength(0);
	});

	it(`sends at most ${NEW_ORDER_EMAILS_PER_DAY} a UTC day per seller, counted for two days`, async () => {
		const capped = world({ sentToday: NEW_ORDER_EMAILS_PER_DAY });
		expect(await notifySellerOfNewOrder(capped.deps, 'ord_1')).toBe('capped');
		expect(capped.sent).toHaveLength(0);
		const lastMinute = world({ now: new Date('2026-10-18T23:59:00Z') });
		await notifySellerOfNewOrder(lastMinute.deps, 'ord_1');
		expect(lastMinute.kv.get('seller-order-emails:seller_1:2026-10-18')).toEqual({ value: '1', ttl: 2 * 24 * 60 * 60 });
	});
});
```
`fulfill.test.ts`: in `fakeDeps`, add `const notified: string[] = [];` and `notifyNewOrder: async (orderId) => void notified.push(orderId),`, and return `notified`. Then add:
```ts
	it('tells the seller about the order once, when it is first recorded', async () => {
		const first = fakeDeps('recorded');
		await recordStoreOrder(first.deps, PAID);
		expect(first.notified).toEqual(['ord_ab12']);
		const again = fakeDeps('already-recorded');
		await recordStoreOrder(again.deps, PAID);
		expect(again.notified).toEqual([]);
	});
```

- [ ] **Step 2: Run them to see them fail**

Run: `rtk proxy bunx vitest run worker/services/store-payments/order-emails.test.ts worker/services/store-payments/fulfill.test.ts`
Expected: FAIL. `./order-emails` is missing, and nothing notifies.

- [ ] **Step 3: Implement**

`templates.ts`. Add next to the other seller emails:
```ts
export interface NewOrderEmailInput {
	storeTitle: string;
	orderNumber: number;
	test: boolean;
	totalCents: number;
	shareCents: number;
	items: ReadonlyArray<{ name: string; quantity: number; kind: 'own' | 'catalog' }>;
	shipTo: { name: string; city: string; region: string | null; countryCode: string } | null;
	note: string | null;
	link: string | null;
}

const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/** To a seller for each new order in their stores: what sold, where it ships, and what they ship themselves. */
export function sellerNewOrderEmail(to: string, order: NewOrderEmailInput): OutgoingEmail {
	const own = order.items.filter((item) => item.kind === 'own').map((item) => item.name);
	const catalog = order.items.filter((item) => item.kind === 'catalog').map((item) => item.name);
	const steps = [
		...(order.test ? ['This was a test order. No money was charged and nothing ships.'] : []),
		...(own.length > 0 ? [`Ship these items: ${own.join(', ')}. Mark the order shipped in Estori when they're on their way.`] : []),
		...(catalog.length > 0 ? [`Estori ships ${catalog.join(', ')}. You don't need to do anything for these.`] : []),
	];
	const shipTo = order.shipTo ? [order.shipTo.name, order.shipTo.city, order.shipTo.region, order.shipTo.countryCode].filter(Boolean).join(', ') : 'No shipping address';
	return renderEmail({
		to,
		subject: `${order.test ? '[Test] ' : ''}New order #${order.orderNumber} at ${order.storeTitle}: ${dollars(order.totalCents)}`,
		heading: 'You have a new order',
		body: steps.join(' '),
		...(order.link ? { action: { label: 'Open the order', link: order.link } } : {}),
		details: [
			['Items', order.items.map((item) => `${item.quantity} × ${item.name}`).join('\n')],
			['Total', dollars(order.totalCents)],
			['Your share', dollars(order.shareCents)],
			['Ship to', shipTo],
			...(order.note ? [['Note', order.note] as const] : []),
		],
		footer: 'You get this email for every order in your stores.',
	});
}
```
`order-emails.ts`:
```ts
/** The email a seller gets for each new order in their stores, at most NEW_ORDER_EMAILS_PER_DAY a UTC day. */

import { createEmailSender } from '../email/sender';
import { configuredBaseUrl } from '../email/links';
import { sellerNewOrderEmail } from '../email/templates';
import type { EmailSender } from '../email/types';
import { SellerOrderService, StoreOrderService } from '../../database';
import { sellerOrderPath } from '../../../shared/types/store-payments';
import type { StoreOrderView } from './store';
import { createLogger } from '../../logger';

export const NEW_ORDER_EMAILS_PER_DAY = 100;
const TWO_DAYS_SECONDS = 2 * 24 * 60 * 60;
const STORE_TITLE_MAX = 60;

export interface NewOrderEmailDeps {
	order(orderId: string): Promise<StoreOrderView | null>;
	facts(orderId: string): Promise<{ storeTitle: string | null; sellerEmail: string | null } | null>;
	sender: EmailSender | null;
	counter: { get(key: string): Promise<string | null>; put(key: string, value: string, options: { expirationTtl: number }): Promise<void> };
	baseUrl: string | null;
	now(): Date;
}

function storeName(title: string | null): string {
	const clean = (title ?? '').replace(/\s+/g, ' ').trim().slice(0, STORE_TITLE_MAX);
	return clean || 'your store';
}

export async function notifySellerOfNewOrder(deps: NewOrderEmailDeps, orderId: string): Promise<'sent' | 'capped' | 'not-sent'> {
	if (!deps.sender) return 'not-sent';
	const [order, facts] = await Promise.all([deps.order(orderId), deps.facts(orderId)]);
	if (!order || !facts?.sellerEmail) return 'not-sent';
	const key = `seller-order-emails:${order.sellerUserId}:${deps.now().toISOString().slice(0, 10)}`;
	const sentToday = Number((await deps.counter.get(key)) ?? '0');
	if (sentToday >= NEW_ORDER_EMAILS_PER_DAY) return 'capped';
	const address = order.shippingAddress;
	await deps.sender.send(
		sellerNewOrderEmail(facts.sellerEmail, {
			storeTitle: storeName(facts.storeTitle),
			orderNumber: order.orderNumber,
			test: order.mode === 'test',
			totalCents: order.totalCents,
			shareCents: order.totalCents - order.applicationFeeCents,
			items: order.items.map((item) => ({ name: item.name, quantity: item.quantity, kind: item.kind })),
			shipTo: address ? { name: address.name, city: address.city, region: address.region, countryCode: address.countryCode } : null,
			note: order.note,
			link: deps.baseUrl ? `${deps.baseUrl}${sellerOrderPath(order.id)}` : null,
		}),
	);
	await deps.counter.put(key, String(sentToday + 1), { expirationTtl: TWO_DAYS_SECONDS });
	return 'sent';
}

const logger = createLogger('SellerOrderEmails');

/** Never throws: a lost email must not undo or retry an order; the Orders page always has it. */
export function newOrderNotifierFromEnv(env: Env): (orderId: string) => Promise<void> {
	const deps: NewOrderEmailDeps = {
		order: (orderId) => new StoreOrderService(env).getOrder(orderId),
		facts: (orderId) => new SellerOrderService(env).newOrderEmailFacts(orderId),
		sender: createEmailSender(env),
		counter: env.VibecoderStore,
		baseUrl: configuredBaseUrl(env),
		now: () => new Date(),
	};
	return async (orderId) => {
		try {
			const outcome = await notifySellerOfNewOrder(deps, orderId);
			if (outcome === 'capped') logger.warn('New-order email skipped: daily cap reached', { orderId });
		} catch (error) {
			logger.error('Could not email the seller about a new order', { orderId, error });
		}
	};
}
```
`fulfill.ts`:
- in `RecordStoreOrderDeps`, add `/** Emails the seller about the order; never throws. */ notifyNewOrder(orderId: string): Promise<void>;`;
- right after `const result = await deps.recordOrder({...});`, add `if (result === 'recorded') await deps.notifyNewOrder(orderId);`.

`wiring.ts`:
- in `recordStoreOrderDeps`, add `notifyNewOrder: newOrderNotifierFromEnv(env),`;
- import `newOrderNotifierFromEnv` from `./order-emails`. `returnPageRecordDeps` spreads the deps, so it inherits this.

- [ ] **Step 4: Run the tests and the store payment suite**

Run: `rtk proxy bunx vitest run worker/services/store-payments worker/services/email`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/services/email/templates.ts worker/services/store-payments/order-emails.ts worker/services/store-payments/order-emails.test.ts worker/services/store-payments/fulfill.ts worker/services/store-payments/fulfill.test.ts worker/services/store-payments/wiring.ts
git commit -m "feat(orders): a seller gets an email for each new order, what they ship and what Estori ships, up to 100 a day"
```

### Task 6: Frontend data and format rules

**Files:**
- Modify: `src/api-types.ts`, `src/lib/api-client.ts` and `src/lib/query-keys.ts`
- Create: `src/hooks/use-seller-orders.ts`
- Create: `src/routes/orders/order-format.ts` and `order-format.test.ts`

**Interfaces:**
- Produces:
  - client methods `getSellerOrders(filters: { view: SellerOrderView; mode: SellerOrderModeFilter; store: string | null; cursor: string | null })`, `getSellerOrder(orderId)` and `setSellerOrderShipment(orderId, body: SellerShipmentRequest)`;
  - hooks `useSellerOrders(filters)`, `useSellerOrder(orderId)`, `useSellerOrderShipment(orderId)` and `useRefundSellerOrder(appId, orderId)`;
  - format helpers `PAYMENT_LABELS`, `CATALOG_PROGRESS_LABELS`, `shippingStatus(row)`, `itemsSummary(row)`, `moneySplit(order)`, `storeLabel(title)`, `customerLabel(name, email)` and `shipToLines(shipTo)`.

- [ ] **Step 1: Write the failing test** (`order-format.test.ts`):
```ts
import { describe, expect, it } from 'vitest';
import { customerLabel, itemsSummary, moneySplit, shipToLines, shippingStatus, storeLabel } from './order-format';

const ROW = { units: 3, ownUnits: 2, catalogUnits: 1, fulfillmentStatus: 'unfulfilled' as const, paymentStatus: 'paid' as const };

describe('orders on the seller pages', () => {
	it('says what the seller ships and what Estori ships', () => {
		expect(shippingStatus(ROW)).toBe('To ship · Estori ships 1');
		expect(shippingStatus({ ...ROW, fulfillmentStatus: 'fulfilled' })).toBe('Shipped · Estori ships 1');
		expect(shippingStatus({ ...ROW, ownUnits: 0 })).toBe('Estori ships 1');
		expect(shippingStatus({ ...ROW, ownUnits: 0, catalogUnits: 0 })).toBe('Nothing to ship');
	});

	it('counts items and those still to ship', () => {
		expect(itemsSummary(ROW)).toBe('3 items, 2 to ship');
		expect(itemsSummary({ ...ROW, units: 1, ownUnits: 0, catalogUnits: 1 })).toBe('1 item');
		expect(itemsSummary({ ...ROW, fulfillmentStatus: 'fulfilled' })).toBe('3 items');
	});

	it("splits the money: paid, Estori's fee, refunded and the seller's share", () => {
		expect(moneySplit({ totalCents: 4599, applicationFeeCents: 460, refundedCents: 1000 })).toEqual({ paidCents: 4599, feeCents: 460, refundedCents: 1000, shareCents: 3139 });
	});

	it('names a deleted store and an unknown shopper, and lays out an address or its absence', () => {
		expect(storeLabel(null)).toBe('Deleted store');
		expect(storeLabel('Northwind Tea')).toBe('Northwind Tea');
		expect(customerLabel(null, 'ana@example.test')).toBe('ana@example.test');
		expect(customerLabel(null, null)).toBe('Unknown shopper');
		expect(shipToLines(null)).toEqual(['No shipping address on this order']);
		expect(shipToLines({ name: 'Ana Ruiz', line1: '12 Elm St', line2: 'Apt 2', city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US' })).toEqual(['Ana Ruiz', '12 Elm St', 'Apt 2', 'Austin, TX 78701', 'US']);
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `rtk proxy bunx vitest run src/routes/orders/order-format.test.ts`
Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement**

`order-format.ts`:
```ts
import type { CatalogItemStatus, SellerOrderDetail, SellerOrderRow, StorePaymentStatus } from '@/api-types';

export const PAYMENT_LABELS: Readonly<Record<StorePaymentStatus, string>> = {
	paid: 'Paid',
	partially_refunded: 'Partly refunded',
	refunded: 'Refunded',
	disputed: 'Disputed',
	dispute_lost: 'Dispute lost',
};

export const CATALOG_PROGRESS_LABELS: Readonly<Record<CatalogItemStatus, string>> = {
	pending: 'Preparing',
	placed: 'Preparing',
	shipped: 'Shipped',
	delivered: 'Delivered',
	rejected: 'Refunded',
	refunded: 'Refunded',
	withheld: 'On hold',
};

type Counts = Pick<SellerOrderRow, 'units' | 'ownUnits' | 'catalogUnits' | 'fulfillmentStatus' | 'paymentStatus'>;

/** "To ship · Estori ships 1": the seller's part, then Estori's. */
export function shippingStatus(row: Counts): string {
	const parts = [...(row.ownUnits > 0 ? [row.fulfillmentStatus === 'fulfilled' ? 'Shipped' : 'To ship'] : []), ...(row.catalogUnits > 0 ? [`Estori ships ${row.catalogUnits}`] : [])];
	return parts.length > 0 ? parts.join(' · ') : 'Nothing to ship';
}

export function itemsSummary(row: Counts): string {
	const items = `${row.units} item${row.units === 1 ? '' : 's'}`;
	const payable = row.paymentStatus === 'paid' || row.paymentStatus === 'partially_refunded';
	return row.ownUnits > 0 && row.fulfillmentStatus === 'unfulfilled' && payable ? `${items}, ${row.ownUnits} to ship` : items;
}

export function moneySplit(order: Pick<SellerOrderDetail, 'totalCents' | 'applicationFeeCents' | 'refundedCents'>) {
	return { paidCents: order.totalCents, feeCents: order.applicationFeeCents, refundedCents: order.refundedCents, shareCents: order.totalCents - order.applicationFeeCents - order.refundedCents };
}

export function storeLabel(title: string | null): string {
	return title?.trim() || 'Deleted store';
}

export function customerLabel(name: string | null, email: string | null): string {
	return name?.trim() || email?.trim() || 'Unknown shopper';
}

export function shipToLines(shipTo: SellerOrderDetail['shipTo']): string[] {
	if (!shipTo) return ['No shipping address on this order'];
	const cityLine = [shipTo.city, [shipTo.region, shipTo.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
	return [shipTo.name, shipTo.line1, ...(shipTo.line2 ? [shipTo.line2] : []), cityLine, shipTo.countryCode].filter(Boolean);
}
```
In `src/api-types.ts`, re-export from `../shared/types/store-payments.js`:
- the types `SellerOrderRow`, `SellerOrdersData`, `SellerOrderDetail`, `SellerOrderLine`, `SellerOrderView`, `SellerOrderModeFilter`, `SellerCarrier`, `SellerShipmentRequest` and `StorePaymentStatus` (if not already exported);
- the values `SELLER_ORDERS_PATH`, `sellerOrderPath`, `SELLER_CARRIERS` and `SELLER_CARRIER_NAMES`.

Make sure `CatalogItemStatus` is exported (Task 17's admin PR already re-exports it).

`api-client.ts`, next to `getStoreOrders`:
```ts
	/** The signed-in seller's orders across their stores, 50 a page. */
	async getSellerOrders(filters: { view: SellerOrderView; mode: SellerOrderModeFilter; store: string | null; cursor: string | null }): Promise<ApiResponse<SellerOrdersData>> {
		const query = new URLSearchParams({ view: filters.view, mode: filters.mode });
		if (filters.store) query.set('store', filters.store);
		if (filters.cursor) query.set('cursor', filters.cursor);
		return this.request<SellerOrdersData>(`/api/orders?${query}`);
	}

	async getSellerOrder(orderId: string): Promise<ApiResponse<SellerOrderDetail>> {
		return this.request<SellerOrderDetail>(`/api/orders/${encodeURIComponent(orderId)}`);
	}

	/** Marks the order's own items shipped, with an optional carrier and tracking number, or not shipped again. */
	async setSellerOrderShipment(orderId: string, body: SellerShipmentRequest): Promise<ApiResponse<SellerOrderDetail>> {
		return this.request<SellerOrderDetail>(`/api/orders/${encodeURIComponent(orderId)}/shipment`, { method: 'POST', body });
	}
```
`query-keys.ts`, under `account`:
```ts
		/** The seller's orders: never persisted, like the rest of `account`. */
		sellerOrders: {
			all: () => [...queryKeys.account.all, 'seller-orders'] as const,
			list: (view: string, mode: string, store: string | null) => [...queryKeys.account.sellerOrders.all(), 'list', view, mode, store ?? 'all'] as const,
			detail: (orderId: string) => [...queryKeys.account.sellerOrders.all(), 'detail', orderId] as const,
		},
```
`use-seller-orders.ts`:
```ts
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SellerOrderModeFilter, SellerOrderView, SellerShipmentRequest } from '@/api-types';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';

export interface SellerOrderFilters {
	view: SellerOrderView;
	mode: SellerOrderModeFilter;
	store: string | null;
}

export function useSellerOrders(filters: SellerOrderFilters) {
	return useInfiniteQuery({
		queryKey: queryKeys.account.sellerOrders.list(filters.view, filters.mode, filters.store),
		queryFn: ({ pageParam }) => unwrap(apiClient.getSellerOrders({ ...filters, cursor: pageParam }), "Couldn't load your orders"),
		initialPageParam: null as string | null,
		getNextPageParam: (page) => page.nextCursor,
		retry: false,
	});
}

export function useSellerOrder(orderId: string) {
	return useQuery({
		queryKey: queryKeys.account.sellerOrders.detail(orderId),
		queryFn: () => unwrap(apiClient.getSellerOrder(orderId), "Couldn't load the order"),
		retry: false,
	});
}

/** Marks the order shipped or not, then shows the answer and reads the lists again. */
export function useSellerOrderShipment(orderId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (body: SellerShipmentRequest) => unwrap(apiClient.setSellerOrderShipment(orderId, body), "Couldn't update the shipment"),
		onSuccess: (order) => {
			queryClient.setQueryData(queryKeys.account.sellerOrders.detail(orderId), order);
			void queryClient.invalidateQueries({ queryKey: queryKeys.account.sellerOrders.all() });
		},
	});
}

/** Refunds lines through the store refund endpoint; one request id per attempt, so a retry never refunds twice. */
export function useRefundSellerOrder(appId: string, orderId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (request: { lineNos: number[]; requestId: string }) => unwrap(apiClient.refundStoreOrder(appId, orderId, request), "Couldn't refund the items"),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.account.sellerOrders.all() });
		},
	});
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `rtk proxy bunx vitest run src/routes/orders/order-format.test.ts` and `bun run typecheck`
Expected: PASS, with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/api-types.ts src/lib/api-client.ts src/lib/query-keys.ts src/hooks/use-seller-orders.ts src/routes/orders/order-format.ts src/routes/orders/order-format.test.ts
git commit -m "feat(orders): the app reads a seller's orders and shipment, with the labels and money split the pages show"
```

### Task 7: The Orders list page and the sidebar item

**Files:**
- Create: `src/routes/orders/orders.tsx` and `src/routes/orders/orders-guard.test.ts`
- Modify: `src/routes.tsx` and `src/components/layout/app-sidebar.tsx`

**Interfaces:**
- Consumes: `useSellerOrders` and the format helpers (Task 6); `SELLER_ORDERS_PATH` and `sellerOrderPath` (Task 1).

- [ ] **Step 1: Write the failing guard test** (`orders-guard.test.ts`):
```ts
import { describe, expect, it } from 'vitest';
import { AI_ASSISTANT_NAMES, SUPPLIER_NAMES } from '../copy-rules';

const sources = import.meta.glob<string>(['/src/routes.tsx', '/src/components/layout/app-sidebar.tsx', '/src/routes/orders/orders.tsx', '/src/routes/orders/order.tsx'], { query: '?raw', import: 'default', eager: true });
const source = (path: string): string => {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
};

describe('the seller Orders pages', () => {
	it('are routed for signed-in users', () => {
		const routes = source('/src/routes.tsx');
		expect(routes).toMatch(/path: 'orders',\s*element: \(\s*<ProtectedRoute>\s*<SellerOrdersPage \/>/);
		expect(routes).toMatch(/path: 'orders\/:id',\s*element: \(\s*<ProtectedRoute>\s*<SellerOrderPage \/>/);
	});

	it('open from an Orders item in the sidebar, folded and open', () => {
		const sidebar = source('/src/components/layout/app-sidebar.tsx');
		expect(sidebar.match(/navigate\(SELLER_ORDERS_PATH\)/g) ?? []).toHaveLength(2);
		expect(sidebar).toContain('id="orders-link"');
	});

	it('list orders to ship by default, with test orders hidden behind a switch, a store filter and Load more', () => {
		const list = source('/src/routes/orders/orders.tsx');
		expect(list).toContain("useState<SellerOrderView>('to-ship')");
		expect(list).toContain('useState(false)');
		expect(list).toContain("mode: showTest ? 'all' : 'live'");
		expect(list).toContain('Show test orders');
		expect(list).toContain('data.stores');
		expect(list).toContain('orders.fetchNextPage()');
		expect(list).toContain('shippingStatus(order)');
	});

	it('name no supplier or AI assistant', () => {
		for (const path of ['/src/routes/orders/orders.tsx', '/src/routes/orders/order.tsx']) {
			const text = (sources[path] ?? '').toLowerCase();
			for (const name of [...SUPPLIER_NAMES, ...AI_ASSISTANT_NAMES]) expect(text, `${path}: ${name}`).not.toContain(name);
		}
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `rtk proxy bunx vitest run src/routes/orders/orders-guard.test.ts`
Expected: FAIL. The page and its routes don't exist yet.

- [ ] **Step 3: Implement**

`src/routes/orders/orders.tsx` holds the list page, built like `src/routes/admin/catalog-orders.tsx`. It has:
- a view toggle (`To ship`, `All orders`), held in `useState<SellerOrderView>('to-ship')`;
- `const [showTest, setShowTest] = useState(false);`, with a labelled checkbox reading "Show test orders";
- a `<select>` store filter, filled from `orders.data?.pages[0]?.stores` (assign `const data = orders.data?.pages[0];` and use `data.stores`), with "All stores" first and each store named through `storeLabel(store.title)`;
- `useSellerOrders({ view, mode: showTest ? 'all' : 'live', store })`, with the rows from `pages.flatMap((page) => page.orders)`;
- on desktop (`hidden sm:block`), a table with these columns:
  - Order: `Order #{n}`, linking to `sellerOrderPath(order.id)`, with the date under it;
  - Store: `storeLabel`;
  - Customer: `customerLabel`, with the email under the name;
  - Items: `itemsSummary`;
  - Total: `formatCents`;
  - Payment: `PAYMENT_LABELS`, in a Badge, plus a Test badge for test orders;
  - Shipping: `shippingStatus(order)`;
- on phones, the same fields as stacked cards (`sm:hidden`);
- empty states, worded as in the spec:
  - to ship: "Nothing to ship", with "Orders with items you ship yourself show up here.";
  - all: "No orders yet", with "Orders from your stores show up here once shoppers buy.";
  - while test orders are hidden and `data.hasTestOrders` is true, an added line "Your test orders are hidden." and a button that turns `showTest` on;
- `{orders.hasNextPage && <Button onClick={() => void orders.fetchNextPage()} loading={orders.isFetchingNextPage}>Load more</Button>}`.

`routes.tsx`:
- import `SellerOrdersPage from './routes/orders/orders'` and `SellerOrderPage from './routes/orders/order'`;
- after the `catalog` route, add `{ path: 'orders', element: (<ProtectedRoute><SellerOrdersPage /></ProtectedRoute>) }` and `{ path: 'orders/:id', element: (<ProtectedRoute><SellerOrderPage /></ProtectedRoute>) }`, formatted like their neighbours.

Create a minimal `src/routes/orders/order.tsx` now, so the import resolves. Task 8 fills it:
```tsx
export default function SellerOrderPage() {
	return null;
}
```
`app-sidebar.tsx`:
- import `ReceiptIcon` from `@phosphor-icons/react`, and `SELLER_ORDERS_PATH` from `@/api-types`;
- in the folded rail, after the Catalog button inside `{user && (...)}`, add a button with `id="orders-link"`, `aria-label="Orders"`, `title="Orders"`, `aria-current={pathname.startsWith(SELLER_ORDERS_PATH) ? 'page' : undefined}`, `onClick={() => navigate(SELLER_ORDERS_PATH)}` and `icon={<ReceiptIcon className="size-4" />}`, styled like the Catalog button;
- in the open menu, after Catalog, add a `<Sidebar.MenuButton active={pathname.startsWith(SELLER_ORDERS_PATH)} icon={<ReceiptIcon weight="duotone" className="size-4 -mr-1" />} id="orders-link" tooltip="Orders" onClick={() => navigate(SELLER_ORDERS_PATH)}>Orders</Sidebar.MenuButton>` inside the `{user && (...)}` block.

- [ ] **Step 4: Run the guard test and the typecheck**

Run: `rtk proxy bunx vitest run src/routes/orders` and `bun run typecheck`
Expected: PASS, with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/orders src/routes.tsx src/components/layout/app-sidebar.tsx
git commit -m "feat(orders): an Orders page in the sidebar lists a seller's orders to ship, all of them, by store, with test orders hidden"
```

### Task 8: The order page, Mark shipped and refunds

**Files:**
- Modify: `src/routes/orders/order.tsx`
- Test: `src/routes/orders/orders-guard.test.ts` (add tests)

**Interfaces:**
- Consumes: `useSellerOrder`, `useSellerOrderShipment` and `useRefundSellerOrder` (Task 6), and `ConfirmButton` (`@/components/confirm-button`). The dialog uses `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle` and `DialogDescription` from `@/components/ui/dialog`.

- [ ] **Step 1: Write the failing guard tests** (append to `orders-guard.test.ts`)

```ts
	it('shows the order with the seller and Estori parts apart, the money split and the warnings', () => {
		const page = source('/src/routes/orders/order.tsx');
		for (const part of ['You ship', 'Estori ships', 'moneySplit(order)', 'shipToLines(order.shipTo)', 'order.needsAttention', 'order.dispute', 'CATALOG_PROGRESS_LABELS', 'order.note']) expect(page, part).toContain(part);
	});

	it('marks the order shipped with a carrier and tracking number, edits it, and asks before marking it not shipped', () => {
		const page = source('/src/routes/orders/order.tsx');
		expect(page).toContain('SELLER_CARRIERS.map');
		expect(page).toContain('shipment.mutate(');
		expect(page).toMatch(/<ConfirmButton[^>]*label="Mark as not shipped"/);
		expect(page).toContain('disabled={shipment.isPending}');
	});

	it('refunds chosen lines once per attempt, and keeps the button off while it runs', () => {
		const page = source('/src/routes/orders/order.tsx');
		expect(page).toContain('crypto.randomUUID()');
		expect(page).toContain('refund.mutate(');
		expect(page).toContain('disabled={refund.isPending || chosen.length === 0}');
		expect(page).toContain('!item.refunded');
	});
```

- [ ] **Step 2: Run them to see them fail**

Run: `rtk proxy bunx vitest run src/routes/orders/orders-guard.test.ts`
Expected: FAIL, because the stub page has none of this yet.

- [ ] **Step 3: Implement** `src/routes/orders/order.tsx`. It follows `src/routes/admin/catalog-order.tsx`'s layout and loading, forbidden and error states, with the "Couldn't load the order" error empty state.

**Header:**
- a back link to `SELLER_ORDERS_PATH` reading "Orders";
- an `h1` of `Order #{order.orderNumber}` at `storeLabel(order.storeTitle)`;
- `PAYMENT_LABELS` and Test badges, and the date.

**Banners:**
- `order.needsAttention`: `<p role="status">Check this order before you ship: {order.needsAttention}</p>`;
- `order.paymentStatus === 'disputed' && order.dispute`: `<p role="alert">The shopper's bank is reviewing this payment ({formatCents(order.dispute.amountCents)}).</p>`;
- `order.paymentStatus === 'dispute_lost'`: `<p role="alert">The shopper's bank sided with them. The amount and Stripe's dispute fee came out of your sales.</p>`.

**Customer:** `customerLabel`, a `mailto:` email link, and `order.customerPhone`.

**Ship to:** `shipToLines(order.shipTo)` with a Copy button (`navigator.clipboard.writeText(lines.join('\n'))`, then `toast.success('Address copied')`).

**Note:** `order.note` in a `whitespace-pre-wrap` paragraph, when present.

**Items:** two sections from `order.items`:
- **"You ship"** (`kind === 'own'`): name, quantity, `formatCents(unitPriceCents * quantity)`, and "Refunded" when `item.refunded`.
- **"Estori ships"** (`kind === 'catalog'`): the same fields, plus the status `CATALOG_PROGRESS_LABELS[progress.status]` and tracking. `progress` is `order.catalogItems.find((entry) => entry.catalogVariantId === item.catalogVariantId)`, and the text reads "Preparing" when it's missing.

**Shipment section** (only when an own line exists): a `ShipmentPanel` component.
- **When `order.fulfillmentStatus === 'fulfilled'`:**
  - text: `Shipped on {new Date(order.shippedAt).toLocaleDateString()}`, then the carrier and tracking when set;
  - an Edit button that opens the form;
  - `<ConfirmButton label="Mark as not shipped" title="Mark this order as not shipped?" description="It goes back to your To ship list." pending={shipment.isPending} onConfirm={() => shipment.mutate({ shipped: false }, ...)} variant="ghost" />`.
- **The form:**
  - a carrier `<select>`: an empty "No carrier" option, then `SELLER_CARRIERS.map((carrier) => <option value={carrier}>{carrier === 'other' ? 'Other' : SELLER_CARRIER_NAMES[carrier]}</option>)`;
  - a text input for the carrier's name, shown only for `other`, with `maxLength={40}`;
  - a tracking number input with `maxLength={64}`;
  - a submit button, `Mark shipped` (or `Save` when editing), with `disabled={shipment.isPending}`, calling `shipment.mutate({ shipped: true, carrier: carrier || null, carrierName, trackingNumber }, { onSuccess: () => toast.success('Marked shipped'), onError: (error) => toast.error(error.message) })`.

**Money:** `moneySplit(order)` rendered as "Paid by the shopper", "Estori's fee", "Refunded" and "Your share", with the line "Payouts follow your payout schedule." under them.

**Refunds:** a "Refund items" button opens a `Dialog`.
- It lists `order.items.filter((item) => !item.refunded)` with checkboxes, held in `const [chosen, setChosen] = useState<number[]>([])`.
- It shows the chosen total.
- The confirm button reads `Refund {formatCents(total)}`. It has `disabled={refund.isPending || chosen.length === 0}` and calls `refund.mutate({ lineNos: chosen, requestId: crypto.randomUUID() }, { onSuccess: () => { toast.success('Refunded'); setOpen(false); setChosen([]); void detail.refetch(); }, onError: (error) => toast.error(error.message) })`.
- The button is hidden when no line is left to refund, or when `paymentStatus` is `refunded`.

- [ ] **Step 4: Run the guard tests and the typecheck**

Run: `rtk proxy bunx vitest run src/routes/orders` and `bun run typecheck`
Expected: PASS, with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/orders/order.tsx src/routes/orders/orders-guard.test.ts
git commit -m "feat(orders): an order page shows what to ship and where, marks it shipped with tracking, and refunds chosen lines"
```

### Task 9: Check it end to end, then the CI steps

**Files:** none beyond fixes the checks call for.

- [ ] **Step 1: Apply the migration locally and restart the dev server**

Run: `npx wrangler d1 migrations apply vibesdk-db --local`. Expected: 0027 applied. Restart the dev server (port 8100) if it was running.

- [ ] **Step 2: Check by eye as the local creator**

Sign in through the localhost helper (`http://localhost:8199/as/creator`).
- Open `/orders` and check:
  - the sidebar item;
  - the To ship and All views;
  - the store filter;
  - Show test orders.
- Open an order and check:
  - its sections;
  - Mark shipped with a carrier and tracking number, then edit it, then "Mark as not shipped";
  - the refund dialog (open it, pick a line, cancel).

If the local data has no order with own lines, insert one into the local D1 for the creator's store, and note it in the ledger.

- [ ] **Step 3: Check the email**

Place a local test order if checkout works locally; the dev log prints "Email not sent (dev log)" with the subject. If the store is paused locally, record a ruling and rely on Task 5's rendered-text tests.

- [ ] **Step 4: Run the CI steps**

Run, in order: `rtk proxy bunx eslint .`, `bun run typecheck`, `bun run build`, `bun run bundle:check` and `bun run test`.
Expected: no lint errors, 0 type errors, the build and bundle pass, and the suite is green.

- [ ] **Step 5: Push and open the PR into `main`**

```bash
git push -u origin feat/seller-orders
gh pr create --repo alastrat/vibesdk --base main --head feat/seller-orders --title "feat(orders): seller orders page, mark shipped, refunds and new-order email" --body-file <scratchpad>/seller-orders-pr.md
```
