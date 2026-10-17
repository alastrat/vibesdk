# CJ Supplier Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A paid catalog order becomes one paid CJ order (a sandbox order outside production), its tracking reaches the catalog items, and items CJ can't fill are refunded.

**Architecture:** A `CJDropshippingAdapter` implements the catalog plan's `SupplierAdapter` with an order number derived from the order id and lines, so retries never place twice. One Durable Object per catalog order (`CatalogOrderRunner`) runs a pure `runnerStep` on alarms: placement with the catalog plan's retries, refunds of rejected items, and polling CJ for tracking until delivery. Checkout's hand-off starts the runner.

**Tech Stack:** Cloudflare Workers, Durable Objects with alarms, D1, Stripe REST, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-15-cjdropshipping-adapter-design.md` (plan 2), with the owner's two contract changes (`cancelled`, tracking replacement) already in `worker/services/catalog/updates.ts`.

## Global Constraints

- **Sandbox only.** Orders carry `isSandbox: 1` and are paid with `shopping/sandbox/simulatePay` unless `isProd(env)` and `env.CATALOG_SUPPLIER_LIVE === 'true'`, both. Nothing in this branch sets that variable, and nothing here calls the balance endpoints.
- `orderNumber` = `<catalog order id>-<first 8 hex of sha256("vid:qty" sorted, comma-joined)>`, at most 50 characters.
- The adapter returns `ok` only for a paid order whose lines match the request, and never pays one whose lines differ.
- Carrier text shown to sellers is a last-mile carrier name (USPS, UPS, FedEx, DHL) or "Standard shipping", never the supplier's channel name.
- The shopper's email is never sent to CJ.
- `wrangler.jsonc` gets only the structural lines (the runner binding, migration `v7`, the crons); the owner's local overrides stay uncommitted. `wrangler.estori.jsonc` gets the same lines.
- No `any`; tabs in `worker/services/`, four spaces in `worker/api/` and `worker/database/`; commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests: `npx vitest run <files>` after loopback sockets drain.

## Review Focus

1. A timeout after CJ created and paid the order: the next attempt finds it by order number and returns `ok` without creating a second one (Task 2).
2. An unpaid CJ order whose lines differ from the request (an earlier, different attempt): never paid (Task 2).
3. Placement rejects an item: the runner refunds it from the store's state, even when the attempt that rejected it ended in a retry (Task 4).
4. CJ cancels a paid order: the items become `rejected` and are refunded (Task 3's updates through Task 4's runner).
5. The runner's alarm throws midway: the state saved before the throw is kept and the alarm is set again, so no step is lost or repeated (Task 5).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `worker/services/catalog/cj/types.ts`, `cj/client.ts` | Order, detail and sandbox endpoint types and methods |
| `worker/services/catalog/cj/order-number.ts` | `cjOrderNumber` |
| `worker/services/catalog/cj/address.ts` | `cjShippingFields` |
| `worker/services/catalog/cj/adapter.ts` | `CJDropshippingAdapter` |
| `worker/services/catalog/cj/updates.ts` | `cjOrderToUpdates`, `carrierText` |
| `worker/services/catalog/runner.ts` | `RunnerState`, `initialRunnerState`, `runnerStep` |
| `worker/services/catalog/CatalogOrderRunner.ts` | The Durable Object shell and its env wiring |
| `worker/services/catalog/scheduler.ts` | `scheduleCatalogPlacement` |
| `worker/services/store-payments/wiring.ts` | Hand-off starts the runner |
| `worker/api/controllers/catalog/controller.ts`, `worker/api/routes/catalogRoutes.ts` | Admin: runner snapshot, sync now, retry, sandbox moves |
| `wrangler.jsonc`, `wrangler.estori.jsonc`, `worker/types/env.d.ts`, `worker/index.ts` | Binding, migration, crons, export |

---

### Task 1: CJ order endpoints, the order number and the address

**Files:**
- Modify: `worker/services/catalog/cj/types.ts`, `worker/services/catalog/cj/client.ts`
- Create: `worker/services/catalog/cj/order-number.ts`, `worker/services/catalog/cj/address.ts`
- Test: `worker/services/catalog/cj/orders.test.ts`

**Interfaces:**
- Produces:
  - `CjCreateOrderRequest`, `CjCreatedOrder = { orderId: string; shipmentOrderId: string | null; orderStatus: string | null; interceptOrderReasons: Array<{ code: number; message: string }> | null }`, `CjOrderDetail = { orderId: string; orderNum: string | null; orderStatus: string; trackNumber: string | null; trackingProvider: string | null; logisticName: string | null; orderAmount: number | string | null; productList: Array<{ vid: string; quantity: number }> | null }`;
  - `CjClient` gains `createOrder(input: CjCreateOrderRequest): Promise<CjCreatedOrder>`, `getOrderDetail(orderIdOrNumber: string): Promise<CjOrderDetail | null>` (null when CJ has no such order), `simulatePay(orderId: string): Promise<void>`, `payBalance(shipmentOrderId: string): Promise<void>`, `sandboxUpdateStatus(orderId: string, targetStatus: 400 | 500 | 600 | 700): Promise<void>`, `sandboxUpdateTrackNumber(orderId: string, trackNumber: string): Promise<void>`;
  - `cjOrderNumber(reference: string, lines: readonly SupplierOrderLine[]): Promise<string>`;
  - `cjShippingFields(address: ShippingAddress, countryName: string): CjShippingFields`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { cjShippingFields } from './address';
import { createCjClient } from './client';
import { cjOrderNumber } from './order-number';

const ADDRESS = {
	name: '  Ada Lovelace with a very long name that goes on past fifty characters  ',
	line1: '1 Main St',
	line2: null,
	city: 'Austin',
	region: 'TX',
	postalCode: '78701',
	countryCode: 'US',
	phone: '+1 (512) 555-0100',
	email: 'ada@example.com',
};

describe('cjOrderNumber', () => {
	it('derives one number per order and set of lines, whatever their order', async () => {
		const reference = '0b5d3c2e-6f1a-4c8e-9d7b-000000000001';
		const a = await cjOrderNumber(reference, [{ supplierVariantId: 'v2', quantity: 1 }, { supplierVariantId: 'v1', quantity: 2 }]);
		const b = await cjOrderNumber(reference, [{ supplierVariantId: 'v1', quantity: 2 }, { supplierVariantId: 'v2', quantity: 1 }]);
		const c = await cjOrderNumber(reference, [{ supplierVariantId: 'v1', quantity: 2 }]);
		expect(a).toBe(b);
		expect(c).not.toBe(a);
		expect(a).toMatch(new RegExp(`^${reference}-[0-9a-f]{8}$`));
		expect(a.length).toBeLessThanOrEqual(50);
	});
});

describe('cjShippingFields', () => {
	it("maps the shopper's address, cutting lengths and never sending the email", () => {
		const fields = cjShippingFields(ADDRESS, 'United States');
		expect(fields).toEqual({
			shippingCustomerName: 'Ada Lovelace with a very long name that goes on pas',
			shippingAddress: '1 Main St',
			shippingCity: 'Austin',
			shippingProvince: 'TX',
			shippingZip: '78701',
			shippingCountryCode: 'US',
			shippingCountry: 'United States',
			shippingPhone: '+15125550100',
		});
		expect(JSON.stringify(fields)).not.toContain('ada@example.com');
		expect(cjShippingFields({ ...ADDRESS, region: null, line2: 'Unit 4', phone: null }, 'United States')).toMatchObject({ shippingProvince: 'Austin', shippingAddress2: 'Unit 4' });
	});
});

describe('the CJ order endpoints', () => {
	function scripted(answers: unknown[]) {
		const calls: Array<{ url: string; body: unknown }> = [];
		const fakeFetch: typeof fetch = async (input, init) => {
			calls.push({ url: String(input), body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
			return new Response(JSON.stringify(answers.shift()), { status: 200 });
		};
		const session = { token: async () => ({ accessToken: 't', accessTokenExpiresAt: 2_000_000_000_000, openId: '1' }), refresh: async () => ({ accessToken: 't', accessTokenExpiresAt: 2_000_000_000_000, openId: '1' }) };
		return { calls, client: createCjClient({ session, fetchImpl: fakeFetch, sleep: async () => {}, minIntervalMs: 0 }) };
	}

	it('reads an order by its number, and answers null when CJ has none', async () => {
		const { calls, client } = scripted([
			{ code: 200, message: 'Success', data: { orderId: 'cj_1', orderNum: 'n-1', orderStatus: 'UNSHIPPED', trackNumber: null, trackingProvider: null, logisticName: 'USPS', orderAmount: 16.9, productList: [{ vid: 'v1', quantity: 1 }] } },
			{ code: 1603001, message: 'Order not found', data: null },
			{ code: 200, message: 'Success', data: null },
		]);
		expect(await client.getOrderDetail('n-1')).toMatchObject({ orderId: 'cj_1', orderStatus: 'UNSHIPPED' });
		expect(calls[0].url).toBe('https://developers.cjdropshipping.com/api2.0/v1/shopping/order/getOrderDetail?orderId=n-1');
		expect(await client.getOrderDetail('n-2')).toBeNull();
		expect(await client.getOrderDetail('n-3')).toBeNull();
	});

	it('pays sandbox orders by simulation and moves them through the sandbox statuses', async () => {
		const { calls, client } = scripted([{ code: 200, data: true }, { code: 200, data: true }, { code: 200, data: true }]);
		await client.simulatePay('cj_1');
		await client.sandboxUpdateStatus('cj_1', 500);
		await client.sandboxUpdateTrackNumber('cj_1', 'SBX123');
		expect(calls.map((call) => [call.url.split('/v1/')[1], call.body])).toEqual([
			['shopping/sandbox/simulatePay', { orderId: 'cj_1' }],
			['shopping/sandbox/updateStatus', { orderId: 'cj_1', targetStatus: 500 }],
			['shopping/sandbox/updateTrackNumber', { orderId: 'cj_1', trackNumber: 'SBX123' }],
		]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run worker/services/catalog/cj/orders.test.ts`
Expected: FAIL, "Cannot find module './address'".

- [ ] **Step 3: Write the types, endpoints, order number and address**

Append to `worker/services/catalog/cj/types.ts`:

```ts
export interface CjShippingFields {
	shippingCustomerName: string;
	shippingAddress: string;
	shippingAddress2?: string;
	shippingCity: string;
	shippingProvince: string;
	shippingZip: string;
	shippingCountryCode: string;
	shippingCountry: string;
	shippingPhone?: string;
}

export interface CjCreateOrderRequest extends CjShippingFields {
	orderNumber: string;
	logisticName: string;
	fromCountryCode: string;
	/** 3 creates the order without paying it. */
	payType: 3;
	isSandbox: 0 | 1;
	products: Array<{ vid: string; quantity: number }>;
}

export interface CjCreatedOrder {
	orderId: string;
	shipmentOrderId: string | null;
	orderStatus: string | null;
	interceptOrderReasons: Array<{ code: number; message: string }> | null;
}

export interface CjOrderDetail {
	orderId: string;
	orderNum: string | null;
	/** CREATED, IN_CART, UNPAID, UNSHIPPED, SHIPPED, DELIVERED or CANCELLED. */
	orderStatus: string;
	trackNumber: string | null;
	trackingProvider: string | null;
	logisticName: string | null;
	orderAmount: number | string | null;
	productList: Array<{ vid: string; quantity: number }> | null;
}
```

In `worker/services/catalog/cj/client.ts`, import the new types, add to the `CjClient` interface:

```ts
	createOrder(input: CjCreateOrderRequest): Promise<CjCreatedOrder>;
	/** Null when CJ has no order with this id or number. */
	getOrderDetail(orderIdOrNumber: string): Promise<CjOrderDetail | null>;
	/** Sandbox orders only: pays without touching the balance. */
	simulatePay(orderId: string): Promise<void>;
	/** Live orders only: pays from Estori's CJ balance. */
	payBalance(shipmentOrderId: string): Promise<void>;
	sandboxUpdateStatus(orderId: string, targetStatus: 400 | 500 | 600 | 700): Promise<void>;
	sandboxUpdateTrackNumber(orderId: string, trackNumber: string): Promise<void>;
```

and to the returned object:

```ts
		createOrder: (input) => request<CjCreatedOrder>('shopping/order/createOrderV2', { method: 'POST', body: input }),
		getOrderDetail: async (orderIdOrNumber) => {
			try {
				return await request<CjOrderDetail | null>('shopping/order/getOrderDetail', { method: 'GET', query: { orderId: orderIdOrNumber } });
			} catch (error) {
				// CJ answers an unknown order with an error whose message says so.
				if (error instanceof CjApiError && /not (be )?found|not exist/i.test(error.message)) return null;
				throw error;
			}
		},
		simulatePay: async (orderId) => {
			await request<boolean>('shopping/sandbox/simulatePay', { method: 'POST', body: { orderId } });
		},
		payBalance: async (shipmentOrderId) => {
			await request<unknown>('shopping/pay/payBalanceV2', { method: 'POST', body: { shipmentOrderId } });
		},
		sandboxUpdateStatus: async (orderId, targetStatus) => {
			await request<boolean>('shopping/sandbox/updateStatus', { method: 'POST', body: { orderId, targetStatus } });
		},
		sandboxUpdateTrackNumber: async (orderId, trackNumber) => {
			await request<boolean>('shopping/sandbox/updateTrackNumber', { method: 'POST', body: { orderId, trackNumber } });
		},
```

`worker/services/catalog/cj/order-number.ts`:

```ts
/** CJ's order number for a placement: the catalog order id and a digest of its lines, so a retry of the same lines can't place twice. */

import { sha256Hash } from '../../../utils/cryptoUtils';
import type { SupplierOrderLine } from '../supplier';

export async function cjOrderNumber(reference: string, lines: readonly SupplierOrderLine[]): Promise<string> {
	const canonical = lines
		.map((line) => `${line.supplierVariantId}:${line.quantity}`)
		.sort()
		.join(',');
	return `${reference}-${(await sha256Hash(canonical)).slice(0, 8)}`;
}
```

`worker/services/catalog/cj/address.ts`:

```ts
/** The shopper's address as CJ's order fields. The email is never sent: CJ must not contact shoppers. */

import type { ShippingAddress } from '../supplier';
import type { CjShippingFields } from './types';

function cut(value: string, max: number): string {
	return value.trim().slice(0, max);
}

export function cjShippingFields(address: ShippingAddress, countryName: string): CjShippingFields {
	const phone = address.phone ? address.phone.replace(/(?!^\+)[^\d]/g, '') : '';
	return {
		shippingCustomerName: cut(address.name, 50),
		shippingAddress: cut(address.line1, 500),
		...(address.line2 ? { shippingAddress2: cut(address.line2, 500) } : {}),
		shippingCity: cut(address.city, 50),
		shippingProvince: cut(address.region ?? address.city, 50),
		shippingZip: cut(address.postalCode, 20),
		shippingCountryCode: address.countryCode,
		shippingCountry: countryName,
		...(phone && phone.length <= 20 ? { shippingPhone: phone } : {}),
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run worker/services/catalog/cj`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/services/catalog/cj
git commit -m "feat(catalog): cj order endpoints, order numbers and address fields

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The CJ adapter

**Files:**
- Create: `worker/services/catalog/cj/adapter.ts`
- Test: `worker/services/catalog/cj/adapter.test.ts`

**Interfaces:**
- Consumes: Task 1; `SupplierAdapter`, `PlaceOrderResult`, `SupplierOrderLine`, `ShippingAddress` (`worker/services/catalog/supplier.ts`); `chooseFreight` (`refresh.ts`); `classifyCjError` (`cj/errors.ts`); `CATALOG_MAX_DELIVERY_DAYS`.
- Produces: `CjAdapterDeps = { client: Pick<CjClient, 'getOrderDetail' | 'freightCalculate' | 'createOrder' | 'simulatePay' | 'payBalance'>; destinations: Readonly<Record<string, { name: string; origin: string }>>; mode: 'live' | 'sandbox'; alert(alert: SupplierAlert): Promise<void> }`; `SupplierAlert = { kind: 'held-order' | 'low-balance' | 'supplier-account' | 'lines-mismatch'; reference: string; message: string }`; `class CJDropshippingAdapter implements SupplierAdapter`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { CJDropshippingAdapter, type CjAdapterDeps, type SupplierAlert } from './adapter';
import { CjApiError } from './errors';
import { cjOrderNumber } from './order-number';
import type { CjCreateOrderRequest, CjOrderDetail } from './types';

const ADDRESS = { name: 'Ada', line1: '1 Main St', line2: null, city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US', phone: null, email: 'ada@example.com' };
const LINES = [{ supplierVariantId: 'v1', quantity: 2 }];
const REFERENCE = 'co_1';

function detail(status: string, lines = [{ vid: 'v1', quantity: 2 }]): CjOrderDetail {
	return { orderId: 'cj_1', orderNum: 'n', orderStatus: status, trackNumber: null, trackingProvider: null, logisticName: 'USPS', orderAmount: 33.8, productList: lines };
}

function fakeClient(script: { existing?: CjOrderDetail | null; afterPay?: CjOrderDetail; create?: () => Promise<{ orderId: string; shipmentOrderId: string | null; orderStatus: string | null; interceptOrderReasons: null | Array<{ code: number; message: string }> }> } = {}) {
	const created: CjCreateOrderRequest[] = [];
	const paid: string[] = [];
	const balancePaid: string[] = [];
	let reads = 0;
	const client: CjAdapterDeps['client'] = {
		getOrderDetail: async () => {
			reads += 1;
			if (reads === 1) return script.existing ?? null;
			return script.afterPay ?? detail('UNSHIPPED');
		},
		freightCalculate: async () => [{ logisticName: 'USPS US to US', logisticAging: '3-5', totalPostageFee: 0, logisticPrice: 0 }],
		createOrder: async (input) => {
			created.push(input);
			return script.create ? script.create() : { orderId: 'cj_1', shipmentOrderId: 'ship_1', orderStatus: 'CREATED', interceptOrderReasons: null };
		},
		simulatePay: async (orderId) => {
			paid.push(orderId);
		},
		payBalance: async (shipmentOrderId) => {
			balancePaid.push(shipmentOrderId);
		},
	};
	return { client, created, paid, balancePaid };
}

function adapterWith(client: CjAdapterDeps['client'], mode: 'live' | 'sandbox' = 'sandbox') {
	const alerts: SupplierAlert[] = [];
	const adapter = new CJDropshippingAdapter({ client, destinations: { US: { name: 'United States', origin: 'US' } }, mode, alert: async (alert) => void alerts.push(alert) });
	return { adapter, alerts };
}

describe('CJDropshippingAdapter', () => {
	it('creates a sandbox order outside production, pays it by simulation, and confirms it', async () => {
		const { client, created, paid, balancePaid } = fakeClient();
		const { adapter } = adapterWith(client);

		expect(await adapter.placeOrder({ orderReference: REFERENCE, lines: LINES, address: ADDRESS })).toEqual({ ok: true, supplierOrderId: 'cj_1' });
		expect(created[0]).toMatchObject({
			orderNumber: await cjOrderNumber(REFERENCE, LINES),
			payType: 3,
			isSandbox: 1,
			logisticName: 'USPS US to US',
			fromCountryCode: 'US',
			shippingCountryCode: 'US',
			products: [{ vid: 'v1', quantity: 2 }],
		});
		expect(JSON.stringify(created[0])).not.toContain('ada@example.com');
		expect(paid).toEqual(['cj_1']);
		expect(balancePaid).toEqual([]);
	});

	it('returns the paid order a timed-out attempt left behind, without creating another', async () => {
		const { client, created } = fakeClient({ existing: detail('UNSHIPPED') });
		const { adapter } = adapterWith(client);
		expect(await adapter.placeOrder({ orderReference: REFERENCE, lines: LINES, address: ADDRESS })).toEqual({ ok: true, supplierOrderId: 'cj_1' });
		expect(created).toHaveLength(0);
	});

	it('pays an unpaid order it finds only when its lines match, and alerts otherwise', async () => {
		const matching = fakeClient({ existing: detail('UNPAID') });
		expect(await adapterWith(matching.client).adapter.placeOrder({ orderReference: REFERENCE, lines: LINES, address: ADDRESS })).toEqual({ ok: true, supplierOrderId: 'cj_1' });
		expect(matching.paid).toEqual(['cj_1']);

		const different = fakeClient({ existing: detail('UNPAID', [{ vid: 'v9', quantity: 1 }]) });
		const { adapter, alerts } = adapterWith(different.client);
		expect(await adapter.placeOrder({ orderReference: REFERENCE, lines: LINES, address: ADDRESS })).toMatchObject({ ok: false, kind: 'retryable' });
		expect(different.paid).toEqual([]);
		expect(alerts.map((alert) => alert.kind)).toEqual(['lines-mismatch']);
	});

	it('rejects what CJ cannot fill, and retries what may pass', async () => {
		const unavailable = fakeClient({ create: async () => Promise.reject(new CjApiError('Variant off sale', 200, 1602001, 'r')) });
		expect(await adapterWith(unavailable.client).adapter.placeOrder({ orderReference: REFERENCE, lines: LINES, address: ADDRESS })).toEqual({
			ok: false,
			kind: 'rejected',
			reason: 'Variant off sale',
			rejectedVariantIds: [],
		});

		const unfunded = fakeClient({ create: async () => Promise.reject(new CjApiError('Balance too low', 200, 1604000, 'r')) });
		const funded = adapterWith(unfunded.client);
		expect(await funded.adapter.placeOrder({ orderReference: REFERENCE, lines: LINES, address: ADDRESS })).toMatchObject({ ok: false, kind: 'retryable' });
		expect(funded.alerts.map((alert) => alert.kind)).toEqual(['low-balance']);

		const cancelled = fakeClient({ existing: detail('CANCELLED') });
		expect(await adapterWith(cancelled.client).adapter.placeOrder({ orderReference: REFERENCE, lines: LINES, address: ADDRESS })).toMatchObject({ ok: false, kind: 'rejected', rejectedVariantIds: [] });
	});

	it('holds an order CJ intercepts, never paying it', async () => {
		const held = fakeClient({ create: async () => ({ orderId: 'cj_1', shipmentOrderId: null, orderStatus: 'CREATED', interceptOrderReasons: [{ code: 1001, message: 'Address check' }] }) });
		const { adapter, alerts } = adapterWith(held.client);
		expect(await adapter.placeOrder({ orderReference: REFERENCE, lines: LINES, address: ADDRESS })).toMatchObject({ ok: false, kind: 'retryable' });
		expect(held.paid).toEqual([]);
		expect(alerts.map((alert) => alert.kind)).toEqual(['held-order']);
	});

	it('pays live orders from the balance only in live mode', async () => {
		const { client, paid, balancePaid, created } = fakeClient();
		await adapterWith(client, 'live').adapter.placeOrder({ orderReference: REFERENCE, lines: LINES, address: ADDRESS });
		expect(created[0].isSandbox).toBe(0);
		expect(paid).toEqual([]);
		expect(balancePaid).toEqual(['ship_1']);
	});

	it('refuses destinations the catalog does not serve', async () => {
		const { client, created } = fakeClient();
		expect(await adapterWith(client).adapter.placeOrder({ orderReference: REFERENCE, lines: LINES, address: { ...ADDRESS, countryCode: 'FR' } })).toMatchObject({ ok: false, kind: 'rejected' });
		expect(created).toHaveLength(0);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run worker/services/catalog/cj/adapter.test.ts`
Expected: FAIL, "Cannot find module './adapter'".

- [ ] **Step 3: Write the adapter**

```ts
/**
 * The catalog's supplier adapter for CJdropshipping. An order is placed once per order number: an existing order is
 * found first, a new one is created unpaid, paid only when its lines match, and confirmed before `ok`. Outside
 * production it creates sandbox orders and pays them by simulation.
 */

import { CATALOG_MAX_DELIVERY_DAYS } from '../config';
import { chooseFreight } from '../refresh';
import type { PlaceOrderResult, ShippingAddress, SupplierAdapter, SupplierOrderLine } from '../supplier';
import { cjShippingFields } from './address';
import type { CjClient } from './client';
import { classifyCjError } from './errors';
import { cjOrderNumber } from './order-number';
import type { CjOrderDetail } from './types';

export interface SupplierAlert {
	kind: 'held-order' | 'low-balance' | 'supplier-account' | 'lines-mismatch';
	reference: string;
	message: string;
}

export interface CjAdapterDeps {
	client: Pick<CjClient, 'getOrderDetail' | 'freightCalculate' | 'createOrder' | 'simulatePay' | 'payBalance'>;
	destinations: Readonly<Record<string, { name: string; origin: string }>>;
	mode: 'live' | 'sandbox';
	alert(alert: SupplierAlert): Promise<void>;
}

const PAID_STATUSES = ['UNSHIPPED', 'SHIPPED', 'DELIVERED'];
const UNPAID_STATUSES = ['CREATED', 'IN_CART', 'UNPAID'];

function linesMatch(order: CjOrderDetail, lines: readonly SupplierOrderLine[]): boolean {
	const canonical = (pairs: Array<[string, number]>) => pairs.map(([vid, quantity]) => `${vid}:${quantity}`).sort().join(',');
	return canonical((order.productList ?? []).map((line) => [line.vid, line.quantity])) === canonical(lines.map((line) => [line.supplierVariantId, line.quantity]));
}

export class CJDropshippingAdapter implements SupplierAdapter {
	readonly supplier = 'cjdropshipping';

	constructor(private readonly deps: CjAdapterDeps) {}

	async placeOrder(input: { orderReference: string; lines: readonly SupplierOrderLine[]; address: ShippingAddress }): Promise<PlaceOrderResult> {
		const destination = this.deps.destinations[input.address.countryCode];
		if (!destination) return { ok: false, kind: 'rejected', reason: 'Destination not served', rejectedVariantIds: [] };
		const orderNumber = await cjOrderNumber(input.orderReference, input.lines);
		try {
			const existing = await this.deps.client.getOrderDetail(orderNumber);
			if (existing) return await this.continueExisting(existing, input, orderNumber);
			return await this.create(input, orderNumber, destination);
		} catch (error) {
			return this.failure(error, input.orderReference);
		}
	}

	private async continueExisting(order: CjOrderDetail, input: { orderReference: string; lines: readonly SupplierOrderLine[] }, orderNumber: string): Promise<PlaceOrderResult> {
		if (PAID_STATUSES.includes(order.orderStatus)) return { ok: true, supplierOrderId: order.orderId };
		if (order.orderStatus === 'CANCELLED') return { ok: false, kind: 'rejected', reason: 'Cancelled by the supplier', rejectedVariantIds: [] };
		if (!UNPAID_STATUSES.includes(order.orderStatus)) return { ok: false, kind: 'retryable', reason: `Supplier order ${orderNumber} is ${order.orderStatus}` };
		return this.payAndConfirm(order.orderId, null, order, input, orderNumber);
	}

	private async create(input: { orderReference: string; lines: readonly SupplierOrderLine[]; address: ShippingAddress }, orderNumber: string, destination: { name: string; origin: string }): Promise<PlaceOrderResult> {
		const freight = chooseFreight(
			await this.deps.client.freightCalculate({
				startCountryCode: destination.origin,
				endCountryCode: input.address.countryCode,
				zip: input.address.postalCode,
				products: input.lines.map((line) => ({ vid: line.supplierVariantId, quantity: line.quantity })),
			}),
			CATALOG_MAX_DELIVERY_DAYS[input.address.countryCode] ?? 10,
		);
		if (!freight) return { ok: false, kind: 'rejected', reason: 'Undeliverable', rejectedVariantIds: [] };
		const created = await this.deps.client.createOrder({
			orderNumber,
			...cjShippingFields(input.address, destination.name),
			logisticName: freight.logisticName,
			fromCountryCode: destination.origin,
			payType: 3,
			isSandbox: this.deps.mode === 'sandbox' ? 1 : 0,
			products: input.lines.map((line) => ({ vid: line.supplierVariantId, quantity: line.quantity })),
		});
		if (created.interceptOrderReasons && created.interceptOrderReasons.length > 0) {
			const reasons = created.interceptOrderReasons.map((reason) => reason.message || String(reason.code)).join('; ');
			await this.deps.alert({ kind: 'held-order', reference: input.orderReference, message: `Held by the supplier: ${reasons}` });
			return { ok: false, kind: 'retryable', reason: `Held by the supplier: ${reasons}` };
		}
		return this.payAndConfirm(created.orderId, created.shipmentOrderId, null, input, orderNumber);
	}

	private async payAndConfirm(orderId: string, shipmentOrderId: string | null, known: CjOrderDetail | null, input: { orderReference: string; lines: readonly SupplierOrderLine[] }, orderNumber: string): Promise<PlaceOrderResult> {
		const order = known ?? (await this.deps.client.getOrderDetail(orderId));
		if (order && !linesMatch(order, input.lines)) {
			await this.deps.alert({ kind: 'lines-mismatch', reference: input.orderReference, message: `Supplier order ${orderNumber} lists other lines; it was not paid` });
			return { ok: false, kind: 'retryable', reason: 'The supplier order lists other lines' };
		}
		if (this.deps.mode === 'sandbox') await this.deps.client.simulatePay(orderId);
		else await this.deps.client.payBalance(shipmentOrderId ?? orderId);
		const confirmed = await this.deps.client.getOrderDetail(orderId);
		if (confirmed && PAID_STATUSES.includes(confirmed.orderStatus)) return { ok: true, supplierOrderId: orderId };
		return { ok: false, kind: 'retryable', reason: `Supplier order ${orderNumber} is not paid yet` };
	}

	private async failure(error: unknown, reference: string): Promise<PlaceOrderResult> {
		const reason = error instanceof Error ? error.message : String(error);
		switch (classifyCjError(error)) {
			case 'item-unavailable':
				return { ok: false, kind: 'rejected', reason, rejectedVariantIds: [] };
			case 'undeliverable':
				return { ok: false, kind: 'rejected', reason, rejectedVariantIds: [] };
			case 'insufficient-balance':
				await this.deps.alert({ kind: 'low-balance', reference, message: reason });
				return { ok: false, kind: 'retryable', reason };
			case 'account':
			case 'payment-blocked':
			case 'bad-request':
				await this.deps.alert({ kind: 'supplier-account', reference, message: reason });
				return { ok: false, kind: 'retryable', reason };
			default:
				return { ok: false, kind: 'retryable', reason };
		}
	}
}
```

The first created-order read in `payAndConfirm` (when `known` is null) checks the lines CJ stored before paying, which is the spec's step 5. In the test's fake, the first `getOrderDetail` call returns `existing` (null for a new order), the next ones the paid detail.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run worker/services/catalog/cj/adapter.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/services/catalog/cj/adapter.ts worker/services/catalog/cj/adapter.test.ts
git commit -m "feat(catalog): place catalog orders with cj, once per order number

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: CJ orders as supplier updates

**Files:**
- Create: `worker/services/catalog/cj/updates.ts`
- Test: `worker/services/catalog/cj/updates.test.ts`

**Interfaces:**
- Produces: `carrierText(provider: string | null, logisticName: string | null): string`; `cjOrderToUpdates(order: CjOrderDetail): SupplierUpdate[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { carrierText, cjOrderToUpdates } from './updates';
import type { CjOrderDetail } from './types';

const ORDER: CjOrderDetail = { orderId: 'cj_1', orderNum: 'n', orderStatus: 'UNSHIPPED', trackNumber: null, trackingProvider: null, logisticName: 'USPS US to US', orderAmount: 16.9, productList: [{ vid: 'v1', quantity: 1 }] };

describe('cjOrderToUpdates', () => {
	it('reports nothing for an order still being prepared', () => {
		expect(cjOrderToUpdates(ORDER)).toEqual([]);
	});

	it('reports tracking as soon as there is a number, then delivery', () => {
		expect(cjOrderToUpdates({ ...ORDER, orderStatus: 'SHIPPED', trackNumber: '9400111899223197428490', trackingProvider: 'USPS' })).toEqual([
			{ kind: 'shipped', supplierOrderId: 'cj_1', trackingNumber: '9400111899223197428490', carrier: 'USPS' },
		]);
		expect(cjOrderToUpdates({ ...ORDER, orderStatus: 'DELIVERED', trackNumber: 'SBX1', trackingProvider: 'CJPacket' })).toEqual([
			{ kind: 'shipped', supplierOrderId: 'cj_1', trackingNumber: 'SBX1', carrier: 'Standard shipping' },
			{ kind: 'delivered', supplierOrderId: 'cj_1' },
		]);
	});

	it('reports a cancellation of the whole supplier order', () => {
		expect(cjOrderToUpdates({ ...ORDER, orderStatus: 'CANCELLED' })).toEqual([{ kind: 'cancelled', supplierOrderId: 'cj_1', supplierVariantIds: [], reason: 'Cancelled by the supplier' }]);
	});
});

describe('carrierText', () => {
	it("names last-mile carriers and never the supplier's channel", () => {
		expect(carrierText('UPS Ground', null)).toBe('UPS');
		expect(carrierText(null, 'USPS US to US')).toBe('USPS');
		expect(carrierText('Fedex', null)).toBe('FedEx');
		expect(carrierText('CJPacket Ordinary', 'CJPacket')).toBe('Standard shipping');
		expect(carrierText(null, null)).toBe('Standard shipping');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run worker/services/catalog/cj/updates.test.ts`
Expected: FAIL, "Cannot find module './updates'".

- [ ] **Step 3: Write the updates**

```ts
/** What a CJ order's current state means for its catalog items. The runner reads CJ and applies these. */

import type { SupplierUpdate } from '../supplier';
import type { CjOrderDetail } from './types';

const CARRIERS: ReadonlyArray<readonly [RegExp, string]> = [
	[/\busps\b/i, 'USPS'],
	[/\bups\b/i, 'UPS'],
	[/\bfedex\b/i, 'FedEx'],
	[/\bdhl\b/i, 'DHL'],
];

/** A last-mile carrier the shopper can track, or "Standard shipping": never the supplier's channel name. */
export function carrierText(provider: string | null, logisticName: string | null): string {
	const text = `${provider ?? ''} ${logisticName ?? ''}`;
	return CARRIERS.find(([pattern]) => pattern.test(text))?.[1] ?? 'Standard shipping';
}

export function cjOrderToUpdates(order: CjOrderDetail): SupplierUpdate[] {
	if (order.orderStatus === 'CANCELLED') {
		return [{ kind: 'cancelled', supplierOrderId: order.orderId, supplierVariantIds: [], reason: 'Cancelled by the supplier' }];
	}
	const updates: SupplierUpdate[] = [];
	if (order.trackNumber) {
		updates.push({ kind: 'shipped', supplierOrderId: order.orderId, trackingNumber: order.trackNumber, carrier: carrierText(order.trackingProvider, order.logisticName) });
	}
	if (order.orderStatus === 'DELIVERED') updates.push({ kind: 'delivered', supplierOrderId: order.orderId });
	return updates;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run worker/services/catalog/cj/updates.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/services/catalog/cj/updates.ts worker/services/catalog/cj/updates.test.ts
git commit -m "feat(catalog): read cj orders as shipping, delivery and cancellation updates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The runner's steps

**Files:**
- Create: `worker/services/catalog/runner.ts`
- Test: `worker/services/catalog/runner.test.ts`

**Interfaces:**
- Consumes: `placeCatalogOrder`, `nextRetryDelayMs`, `MAX_PLACEMENT_ATTEMPTS` (`placement.ts`); `refundCatalogItems` (`refund-items.ts`); `applySupplierUpdate` (`updates.ts`); `memoryCatalogStore` (`test-support.ts`).
- Produces:
  - `RunnerState = { orderId: string; placement: 'due' | 'done' | 'needs-attention'; nextPlacementAt: number; refundFailures: number; nextRefundAt: number; nextSyncAt: number | null; startedAt: number }`;
  - `initialRunnerState(orderId: string, nowMs: number): RunnerState`;
  - `RunnerDeps = { store: CatalogOrderStore; adapters: PlacementDeps['adapters']; stripe: RefundItemsDeps['stripe'] | null; supplierUpdates(supplierOrderId: string): Promise<readonly SupplierUpdate[]>; alert(alert: { kind: string; orderId: string; message: string }): Promise<void> }`;
  - `runnerStep(state: RunnerState, deps: RunnerDeps, nowMs: number): Promise<{ state: RunnerState; nextAlarmAt: number | null }>`;
  - `RUNNER_SYNC_INTERVAL_MS = 30 * 60 * 1000`, `RUNNER_SYNC_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { RUNNER_SYNC_INTERVAL_MS, initialRunnerState, runnerStep, type RunnerDeps } from './runner';
import { memoryCatalogStore } from './test-support';
import type { PlaceOrderResult, SupplierAdapter, SupplierUpdate } from './supplier';
import type { StripeClient } from '../payments/stripe-client';

const NOW = 1_800_000_000_000;
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

function deps(store: Awaited<ReturnType<typeof storeWithOrder>>, results: PlaceOrderResult[], updates: SupplierUpdate[][] = []) {
	const refunds: number[] = [];
	const alerts: string[] = [];
	const adapter: SupplierAdapter = {
		supplier: 'cjdropshipping',
		placeOrder: async () => results.shift() ?? { ok: false, kind: 'retryable', reason: 'No scripted result' },
	};
	const stripe: Pick<StripeClient, 'retrievePaymentIntent' | 'createRefund' | 'createTransferReversal'> = {
		retrievePaymentIntent: async (id) => ({ id, latest_charge: { id: 'ch_1', transfer: { id: 'tr_1', amount: 5109, amount_reversed: 0 } } }),
		createRefund: async (input) => {
			refunds.push(input.amountCents);
			return { id: 're_1', amount: input.amountCents, status: 'succeeded' };
		},
		createTransferReversal: async (input) => ({ id: 'trr_1', amount: input.amountCents }),
	};
	const runnerDeps: RunnerDeps = {
		store,
		adapters: { cjdropshipping: adapter },
		stripe,
		supplierUpdates: async () => updates.shift() ?? [],
		alert: async (alert) => void alerts.push(alert.kind),
	};
	return { runnerDeps, refunds, alerts };
}

describe('runnerStep', () => {
	it('places the order, then polls the supplier on its interval', async () => {
		const store = await storeWithOrder();
		const { runnerDeps } = deps(store, [{ ok: true, supplierOrderId: 'cj_9' }]);

		const first = await runnerStep(initialRunnerState('co_1', NOW), runnerDeps, NOW);
		expect(first.state.placement).toBe('done');
		expect(first.nextAlarmAt).toBe(NOW + RUNNER_SYNC_INTERVAL_MS);
		expect(store.orders.get('co_1')?.items.map((item) => item.status)).toEqual(['placed', 'placed']);
	});

	it('waits the retry delay after a temporary failure', async () => {
		const store = await storeWithOrder();
		const { runnerDeps } = deps(store, [{ ok: false, kind: 'retryable', reason: 'Timed out' }]);

		const step = await runnerStep(initialRunnerState('co_1', NOW), runnerDeps, NOW);
		expect(step.state).toMatchObject({ placement: 'due', nextPlacementAt: NOW + 60_000 });
		expect(step.nextAlarmAt).toBe(NOW + 60_000);
	});

	it('refunds rejected items from the stored state, including ones rejected by an attempt that then retried', async () => {
		const store = await storeWithOrder();
		const { runnerDeps, refunds } = deps(store, [
			{ ok: false, kind: 'rejected', reason: 'Out of stock', rejectedVariantIds: ['cj_cap'] },
			{ ok: false, kind: 'retryable', reason: 'Timed out' },
		]);

		const step = await runnerStep(initialRunnerState('co_1', NOW), runnerDeps, NOW);
		expect(refunds).toEqual([4000]);
		expect(store.orders.get('co_1')?.items.map((item) => item.status)).toEqual(['pending', 'refunded']);
		expect(step.state.placement).toBe('due');
	});

	it('applies tracking and delivery from the supplier, and stops polling once everything arrived', async () => {
		const store = await storeWithOrder();
		const { runnerDeps } = deps(store, [{ ok: true, supplierOrderId: 'cj_9' }], [
			[{ kind: 'shipped', supplierOrderId: 'cj_9', trackingNumber: 'SBX1', carrier: 'USPS' }],
			[{ kind: 'shipped', supplierOrderId: 'cj_9', trackingNumber: 'SBX1', carrier: 'USPS' }, { kind: 'delivered', supplierOrderId: 'cj_9' }],
		]);

		let step = await runnerStep(initialRunnerState('co_1', NOW), runnerDeps, NOW);
		step = await runnerStep(step.state, runnerDeps, NOW + RUNNER_SYNC_INTERVAL_MS);
		expect(store.orders.get('co_1')?.items.map((item) => [item.status, item.trackingNumber, item.carrier])).toEqual([
			['shipped', 'SBX1', 'USPS'],
			['shipped', 'SBX1', 'USPS'],
		]);
		step = await runnerStep(step.state, runnerDeps, NOW + 2 * RUNNER_SYNC_INTERVAL_MS);
		expect(store.orders.get('co_1')?.items.map((item) => item.status)).toEqual(['delivered', 'delivered']);
		expect(step.nextAlarmAt).toBeNull();
	});

	it('refunds items the supplier cancels after payment', async () => {
		const store = await storeWithOrder();
		const { runnerDeps, refunds } = deps(store, [{ ok: true, supplierOrderId: 'cj_9' }], [[{ kind: 'cancelled', supplierOrderId: 'cj_9', supplierVariantIds: [], reason: 'Cancelled' }]]);

		const first = await runnerStep(initialRunnerState('co_1', NOW), runnerDeps, NOW);
		await runnerStep(first.state, runnerDeps, NOW + RUNNER_SYNC_INTERVAL_MS);
		expect(refunds.sort()).toEqual([4000, 5000]);
		expect(store.orders.get('co_1')?.items.every((item) => item.status === 'refunded')).toBe(true);
	});

	it('hands a refund that keeps failing to the owner', async () => {
		const store = await storeWithOrder();
		const { runnerDeps, alerts } = deps(store, [{ ok: false, kind: 'rejected', reason: 'Gone', rejectedVariantIds: [] }]);
		runnerDeps.stripe = { ...runnerDeps.stripe!, createRefund: async () => Promise.reject(new Error('Stripe down')) };

		let step = await runnerStep(initialRunnerState('co_1', NOW), runnerDeps, NOW);
		for (let attempt = 1; attempt < 6; attempt += 1) step = await runnerStep(step.state, runnerDeps, step.nextAlarmAt ?? NOW);
		expect(store.orders.get('co_1')?.status).toBe('needs-attention');
		expect(alerts).toContain('refund-failed');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run worker/services/catalog/runner.test.ts`
Expected: FAIL, "Cannot find module './runner'".

- [ ] **Step 3: Write the runner's steps**

```ts
/**
 * What one runner alarm does for a catalog order, in order: place pending items (with the catalog plan's retries),
 * refund rejected items, and read the supplier for tracking until everything arrived. Each step stands alone, so a
 * failure in one never blocks the next. Pure apart from its dependencies.
 */

import { MAX_PLACEMENT_ATTEMPTS, nextRetryDelayMs, placeCatalogOrder, type PlacementDeps } from './placement';
import { refundCatalogItems, type RefundItemsDeps } from './refund-items';
import type { CatalogOrderItemRow, CatalogOrderStore } from './store';
import type { SupplierUpdate } from './supplier';
import { applySupplierUpdate } from './updates';

export const RUNNER_SYNC_INTERVAL_MS = 30 * 60 * 1000;
export const RUNNER_SYNC_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface RunnerState {
	orderId: string;
	placement: 'due' | 'done' | 'needs-attention';
	nextPlacementAt: number;
	refundFailures: number;
	nextRefundAt: number;
	/** When to read the supplier next; null when nothing is in transit. */
	nextSyncAt: number | null;
	startedAt: number;
}

export interface RunnerDeps {
	store: CatalogOrderStore;
	adapters: PlacementDeps['adapters'];
	stripe: RefundItemsDeps['stripe'] | null;
	supplierUpdates(supplierOrderId: string): Promise<readonly SupplierUpdate[]>;
	alert(alert: { kind: string; orderId: string; message: string }): Promise<void>;
}

export function initialRunnerState(orderId: string, nowMs: number): RunnerState {
	return { orderId, placement: 'due', nextPlacementAt: nowMs, refundFailures: 0, nextRefundAt: nowMs, nextSyncAt: null, startedAt: nowMs };
}

function inTransit(items: readonly CatalogOrderItemRow[]): CatalogOrderItemRow[] {
	return items.filter((item) => (item.status === 'placed' || item.status === 'shipped') && item.supplierOrderId !== null);
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function place(state: RunnerState, deps: RunnerDeps, nowMs: number): Promise<RunnerState> {
	if (state.placement !== 'due' || nowMs < state.nextPlacementAt) return state;
	const outcome = await placeCatalogOrder({ store: deps.store, adapters: deps.adapters }, state.orderId);
	switch (outcome.kind) {
		case 'retry':
			return { ...state, nextPlacementAt: nowMs + outcome.delayMs };
		case 'done':
			return { ...state, placement: 'done', nextSyncAt: nowMs + RUNNER_SYNC_INTERVAL_MS };
		case 'needs-attention':
			await deps.alert({ kind: 'needs-attention', orderId: state.orderId, message: outcome.reason });
			return { ...state, placement: 'needs-attention', nextSyncAt: nowMs + RUNNER_SYNC_INTERVAL_MS };
		case 'not-found':
			await deps.alert({ kind: 'needs-attention', orderId: state.orderId, message: 'The catalog order does not exist' });
			return { ...state, placement: 'done', nextSyncAt: null };
	}
}

/** Rejected items are refunded from the store's state, so none is missed whichever attempt rejected it. */
async function refund(state: RunnerState, deps: RunnerDeps, nowMs: number): Promise<RunnerState> {
	const order = await deps.store.getOrder(state.orderId);
	const rejected = order?.items.filter((item) => item.status === 'rejected') ?? [];
	if (!order || rejected.length === 0 || nowMs < state.nextRefundAt || !deps.stripe) return state;
	try {
		await refundCatalogItems({ store: deps.store, stripe: deps.stripe }, { orderId: order.id, itemIds: rejected.map((item) => item.id), reason: 'supplier-rejected' });
		return { ...state, refundFailures: 0, nextRefundAt: nowMs };
	} catch (error) {
		const refundFailures = state.refundFailures + 1;
		if (refundFailures >= MAX_PLACEMENT_ATTEMPTS) {
			await deps.store.updateOrder(order.id, { status: 'needs-attention', placementAttempts: order.placementAttempts, lastError: `Refund of rejected items failed: ${errorText(error)}` });
			await deps.alert({ kind: 'refund-failed', orderId: order.id, message: errorText(error) });
		}
		return { ...state, refundFailures, nextRefundAt: nowMs + nextRetryDelayMs(refundFailures) };
	}
}

async function sync(state: RunnerState, deps: RunnerDeps, nowMs: number): Promise<RunnerState> {
	if (state.nextSyncAt === null || nowMs < state.nextSyncAt) return state;
	const order = await deps.store.getOrder(state.orderId);
	if (!order) return { ...state, nextSyncAt: null };
	let items = [...order.items];
	for (const supplierOrderId of new Set(inTransit(items).map((item) => item.supplierOrderId as string))) {
		for (const update of await deps.supplierUpdates(supplierOrderId)) {
			const patches = applySupplierUpdate(items, update);
			if (patches.length === 0) continue;
			await deps.store.patchItems(patches);
			items = items.map((item) => {
				const patch = patches.find((candidate) => candidate.itemId === item.id);
				if (!patch) return item;
				const { itemId: _itemId, ...fields } = patch;
				return { ...item, ...fields };
			});
		}
	}
	const stillOpen = inTransit(items).length > 0 && nowMs - state.startedAt < RUNNER_SYNC_MAX_AGE_MS;
	return { ...state, nextSyncAt: stillOpen ? nowMs + RUNNER_SYNC_INTERVAL_MS : null };
}

export async function runnerStep(state: RunnerState, deps: RunnerDeps, nowMs: number): Promise<{ state: RunnerState; nextAlarmAt: number | null }> {
	let next = state;
	for (const step of [place, refund, sync, refund]) {
		try {
			next = await step(next, deps, nowMs);
		} catch (error) {
			await deps.alert({ kind: 'runner-step-failed', orderId: state.orderId, message: errorText(error) });
		}
	}
	const order = await deps.store.getOrder(state.orderId);
	const refundDue = (order?.items.some((item) => item.status === 'rejected') ?? false) && next.refundFailures < MAX_PLACEMENT_ATTEMPTS;
	const times = [next.placement === 'due' ? next.nextPlacementAt : null, refundDue ? next.nextRefundAt : null, next.nextSyncAt].filter((time): time is number => time !== null);
	return { state: next, nextAlarmAt: times.length > 0 ? Math.max(Math.min(...times), nowMs + 1000) : null };
}
```

`refund` runs again after `sync`, so items a cancellation rejects are refunded in the same alarm. The minimum of one second between alarms keeps a due step from spinning.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run worker/services/catalog/runner.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/services/catalog/runner.ts worker/services/catalog/runner.test.ts
git commit -m "feat(catalog): the catalog order runner's placement, refund and tracking steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The runner Durable Object, its config, and the hand-off from checkout

**Files:**
- Create: `worker/services/catalog/CatalogOrderRunner.ts`
- Modify: `worker/services/catalog/scheduler.ts` (`scheduleCatalogPlacement`), `worker/services/store-payments/wiring.ts`, `worker/index.ts` (export), `worker/types/env.d.ts` (`CATALOG_ORDER_RUNNER`, `CATALOG_SUPPLIER_LIVE`), `wrangler.jsonc` and `wrangler.estori.jsonc` (binding, `v7`, crons), `scripts/estori-config.test.ts`
- Test: `worker/services/catalog/runner-wiring.test.ts`

**Interfaces:**
- Consumes: Tasks 1-4; `stripeFromEnv`; `cjClientFromEnv`; `isProd`.
- Produces: `CatalogOrderRunner` with RPC `start(orderId)`, `signal()`, `retry()`, `snapshot()`; `catalogSupplierMode(env: Env): 'live' | 'sandbox'`; `scheduleCatalogPlacement(env: Env, orderId: string): Promise<void>`; crons `*/15 * * * *`, `5 * * * *`, `35 6 * * *`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { catalogSupplierMode } from './CatalogOrderRunner';

const sources = import.meta.glob<string>(['/worker/index.ts', '/worker/services/store-payments/wiring.ts', '/wrangler.jsonc', '/wrangler.estori.jsonc'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('the catalog order runner wiring', () => {
	it('places sandbox orders unless production says live in so many words', () => {
		expect(catalogSupplierMode({ ENVIRONMENT: 'dev' } as unknown as Env)).toBe('sandbox');
		expect(catalogSupplierMode({ ENVIRONMENT: 'dev', CATALOG_SUPPLIER_LIVE: 'true' } as unknown as Env)).toBe('sandbox');
		expect(catalogSupplierMode({ ENVIRONMENT: 'prod' } as unknown as Env)).toBe('sandbox');
		expect(catalogSupplierMode({ ENVIRONMENT: 'prod', CATALOG_SUPPLIER_LIVE: 'true' } as unknown as Env)).toBe('live');
	});

	it('exports the runner, binds it in both configs, and starts it from the checkout hand-off', () => {
		expect(source('/worker/index.ts')).toContain("export { CatalogOrderRunner } from './services/catalog/CatalogOrderRunner';");
		for (const config of ['/wrangler.jsonc', '/wrangler.estori.jsonc']) {
			const text = source(config);
			expect(text).toContain('"class_name": "CatalogOrderRunner"');
			expect(text).toContain('"name": "CATALOG_ORDER_RUNNER"');
			expect(text).toMatch(/"new_sqlite_classes": \[\s*"CatalogOrderRunner"\s*\],\s*"tag": "v7"/);
			expect(text).toContain('"crons": ["*/15 * * * *", "5 * * * *", "35 6 * * *"]');
		}
		expect(source('/worker/services/store-payments/wiring.ts')).toContain('scheduleCatalogPlacement(env, recorded.orderId)');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run worker/services/catalog/runner-wiring.test.ts`
Expected: FAIL, "Cannot find module './CatalogOrderRunner'".

- [ ] **Step 3: Write the Durable Object**

`worker/services/catalog/CatalogOrderRunner.ts`:

```ts
/**
 * One Durable Object per catalog order: it stores the runner's state and runs `runnerStep` on alarms, after the webhook
 * has answered. RPC methods only store state and set the alarm; no supplier call runs inside an RPC.
 */

import { DurableObject } from 'cloudflare:workers';
import { CATALOG_DESTINATIONS } from '../../../shared/types/catalog';
import { createLogger } from '../../logger';
import { CatalogOrderService } from '../../database';
import { isProd } from '../../utils/envs';
import { stripeFromEnv } from '../payments/config';
import { CJDropshippingAdapter } from './cj/adapter';
import { cjClientFromEnv } from './cj/client';
import { cjOrderToUpdates } from './cj/updates';
import { initialRunnerState, runnerStep, type RunnerDeps, type RunnerState } from './runner';

const logger = createLogger('CatalogOrderRunner');
const STATE_KEY = 'state';

/** Live supplier orders need production and an explicit switch; everything else is a sandbox order. */
export function catalogSupplierMode(env: Env): 'live' | 'sandbox' {
	return isProd(env) && env.CATALOG_SUPPLIER_LIVE === 'true' ? 'live' : 'sandbox';
}

function runnerDeps(env: Env): RunnerDeps {
	const client = cjClientFromEnv(env);
	const alert: RunnerDeps['alert'] = async (event) => {
		logger.error('Catalog order needs the owner', event);
	};
	const adapter = client
		? new CJDropshippingAdapter({ client, destinations: CATALOG_DESTINATIONS, mode: catalogSupplierMode(env), alert: (event) => alert({ kind: event.kind, orderId: event.reference, message: event.message }) })
		: { supplier: 'cjdropshipping' as const, placeOrder: async () => ({ ok: false as const, kind: 'retryable' as const, reason: 'The catalog supplier is not configured' }) };
	return {
		store: new CatalogOrderService(env),
		adapters: { cjdropshipping: adapter },
		stripe: stripeFromEnv(env),
		supplierUpdates: async (supplierOrderId) => {
			const order = client ? await client.getOrderDetail(supplierOrderId) : null;
			return order ? cjOrderToUpdates(order) : [];
		},
		alert,
	};
}

export class CatalogOrderRunner extends DurableObject<Env> {
	private async state(): Promise<RunnerState | null> {
		return (await this.ctx.storage.get<RunnerState>(STATE_KEY)) ?? null;
	}

	/** Idempotent: a second start for the same order does nothing. */
	async start(orderId: string): Promise<void> {
		if (await this.state()) return;
		await this.ctx.storage.put(STATE_KEY, initialRunnerState(orderId, Date.now()));
		await this.ctx.storage.setAlarm(Date.now());
	}

	/** Something changed at the supplier: read it now. */
	async signal(): Promise<void> {
		const state = await this.state();
		if (!state) return;
		await this.ctx.storage.put(STATE_KEY, { ...state, nextSyncAt: Date.now() });
		await this.ctx.storage.setAlarm(Date.now());
	}

	/** Admin: one more placement or refund attempt now. */
	async retry(): Promise<void> {
		const state = await this.state();
		if (!state) return;
		const now = Date.now();
		const placement = state.placement === 'needs-attention' ? 'due' : state.placement;
		await this.ctx.storage.put(STATE_KEY, { ...state, placement, nextPlacementAt: now, refundFailures: 0, nextRefundAt: now, nextSyncAt: state.nextSyncAt ?? now });
		await this.ctx.storage.setAlarm(now);
	}

	async snapshot(): Promise<RunnerState | null> {
		return this.state();
	}

	async alarm(): Promise<void> {
		const state = await this.state();
		if (!state) return;
		const result = await runnerStep(state, runnerDeps(this.env), Date.now());
		await this.ctx.storage.put(STATE_KEY, result.state);
		if (result.nextAlarmAt !== null) await this.ctx.storage.setAlarm(result.nextAlarmAt);
	}
}
```

Append to `worker/services/catalog/scheduler.ts`:

```ts
/** Starts the order's runner. A failure is logged, not thrown: the paid order is recorded either way. */
export async function scheduleCatalogPlacement(env: Env, orderId: string): Promise<void> {
	try {
		const namespace = env.CATALOG_ORDER_RUNNER;
		await namespace.get(namespace.idFromName(orderId)).start(orderId);
	} catch (error) {
		logger.error('Could not start the catalog order runner', { orderId, error });
	}
}
```

In `worker/services/store-payments/wiring.ts`, import `scheduleCatalogPlacement` and change the hand-off to:

```ts
		handOffCatalogLines: async (paid) => {
			const recorded = await recordPaidCatalogOrder({ store: new CatalogOrderService(env), newId: generateId, now: () => new Date() }, paid);
			if (recorded.result === 'recorded' && recorded.orderId) await scheduleCatalogPlacement(env, recorded.orderId);
		},
```

Export the class from `worker/index.ts`, next to `UserSecretsStore`:

```ts
export { CatalogOrderRunner } from './services/catalog/CatalogOrderRunner';
```

Declare in `worker/types/env.d.ts`:

```ts
		// Live supplier orders need ENVIRONMENT prod and this set to "true"; anything else places sandbox orders.
		CATALOG_SUPPLIER_LIVE?: string;
		CATALOG_ORDER_RUNNER: DurableObjectNamespace<import('../services/catalog/CatalogOrderRunner').CatalogOrderRunner>;
```

- [ ] **Step 4: Add the config lines**

In both `wrangler.jsonc` and `wrangler.estori.jsonc`, add to `durable_objects.bindings` after `SPACE_DO`:

```jsonc
            {
                "class_name": "CatalogOrderRunner",
                "name": "CATALOG_ORDER_RUNNER"
            }
```

after the `v6` migration:

```jsonc
        {
            "new_sqlite_classes": [
                "CatalogOrderRunner"
            ],
            "tag": "v7"
        }
```

and at the top level, after `migrations`:

```jsonc
    "triggers": {
        "crons": ["*/15 * * * *", "5 * * * *", "35 6 * * *"]
    },
```

Commit only these lines of `wrangler.jsonc`: write them into the committed version (`git show HEAD:wrangler.jsonc`), stage that, then put the same lines into the working copy that carries the owner's local overrides, so the overrides stay unstaged.

Add to `scripts/estori-config.test.ts` an assertion that `wrangler.estori.jsonc`'s `triggers.crons` equal the three crons above (read the file the way the test already does).

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run worker/services/catalog/runner-wiring.test.ts scripts/estori-config.test.ts worker/services/store-payments`
Expected: PASS.
Run: `npx tsc --noEmit -p tsconfig.worker.json`
Expected: no errors outside `packages/artifacts-viewer`.

- [ ] **Step 6: Commit**

```bash
git add worker/services/catalog/CatalogOrderRunner.ts worker/services/catalog/runner-wiring.test.ts worker/services/catalog/scheduler.ts worker/services/store-payments/wiring.ts worker/index.ts worker/types/env.d.ts wrangler.jsonc wrangler.estori.jsonc scripts/estori-config.test.ts
git commit -m "feat(catalog): run each catalog order in its own durable object, started by checkout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Admin operations and sandbox moves

**Files:**
- Modify: `worker/api/controllers/catalog/controller.ts`, `worker/api/routes/catalogRoutes.ts`
- Test: `worker/api/controllers/catalog/catalog-routes-wiring.test.ts`, `worker/services/catalog/sandbox.test.ts`
- Create: `worker/services/catalog/sandbox.ts`

**Interfaces:**
- Produces: `sandboxMoves(action: 'ship' | 'deliver'): Array<{ kind: 'status'; status: 400 | 500 | 600 } | { kind: 'track' }>`; admin routes `GET /api/admin/catalog/orders/:id/runner`, `POST /api/admin/catalog/orders/:id/sync`, `POST /api/admin/catalog/orders/:id/retry`, `POST /api/admin/catalog/orders/:id/sandbox` (`{ action: 'ship' | 'deliver' }`, refused unless the supplier mode is `sandbox`).

- [ ] **Step 1: Write the failing tests**

`worker/services/catalog/sandbox.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sandboxMoves } from './sandbox';

describe('sandboxMoves', () => {
	it('ships a paid sandbox order with a tracking number, and delivers a shipped one', () => {
		expect(sandboxMoves('ship')).toEqual([{ kind: 'status', status: 400 }, { kind: 'track' }, { kind: 'status', status: 500 }]);
		expect(sandboxMoves('deliver')).toEqual([{ kind: 'status', status: 600 }]);
	});
});
```

Add to `catalog-routes-wiring.test.ts`:

```ts
	it('exposes the runner and sandbox moves to admins only', () => {
		const routes = source('/worker/api/routes/catalogRoutes.ts');
		for (const path of ["'/api/admin/catalog/orders/:id/runner'", "'/api/admin/catalog/orders/:id/sync'", "'/api/admin/catalog/orders/:id/retry'", "'/api/admin/catalog/orders/:id/sandbox'"]) {
			expect(routes.split('\n').find((line) => line.includes(path))).toContain('setAuthLevel(AuthConfig.admin)');
		}
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run worker/services/catalog/sandbox.test.ts worker/api/controllers/catalog`
Expected: FAIL.

- [ ] **Step 3: Write the moves and the admin endpoints**

`worker/services/catalog/sandbox.ts`:

```ts
/** CJ sandbox orders move 300 (paid) to 400, 500 (shipped), 600 (delivered); the sandbox can't skip a status. */

export type SandboxMove = { kind: 'status'; status: 400 | 500 | 600 } | { kind: 'track' };

export function sandboxMoves(action: 'ship' | 'deliver'): SandboxMove[] {
	return action === 'ship' ? [{ kind: 'status', status: 400 }, { kind: 'track' }, { kind: 'status', status: 500 }] : [{ kind: 'status', status: 600 }];
}
```

Add to `CatalogController` (with imports of `catalogSupplierMode`, `cjClientFromEnv`, `sandboxMoves`, `CatalogOrderService`):

```ts
    private static runner(env: Env, orderId: string) {
        return env.CATALOG_ORDER_RUNNER.get(env.CATALOG_ORDER_RUNNER.idFromName(orderId));
    }

    static async runnerSnapshot(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<{ runner: unknown }>>> {
        const orderId = context.pathParams.id;
        if (!orderId) return CatalogController.createErrorResponse('Missing order id', 400);
        return CatalogController.createSuccessResponse({ runner: await CatalogController.runner(env, orderId).snapshot() });
    }

    static async syncNow(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<{ signalled: true }>>> {
        const orderId = context.pathParams.id;
        if (!orderId) return CatalogController.createErrorResponse('Missing order id', 400);
        await CatalogController.runner(env, orderId).signal();
        return CatalogController.createSuccessResponse({ signalled: true });
    }

    static async retryOrder(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<{ retried: true }>>> {
        const orderId = context.pathParams.id;
        if (!orderId) return CatalogController.createErrorResponse('Missing order id', 400);
        await CatalogController.runner(env, orderId).retry();
        return CatalogController.createSuccessResponse({ retried: true });
    }

    /** Moves a sandbox supplier order along, for local runs. Refused for live orders. */
    static async sandboxMove(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<{ moved: string[] }>>> {
        try {
            const orderId = context.pathParams.id;
            const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
            const action = body?.action === 'ship' || body?.action === 'deliver' ? body.action : null;
            if (!orderId || !action) return CatalogController.createErrorResponse('Send { action: "ship" | "deliver" }', 400);
            if (catalogSupplierMode(env) !== 'sandbox') return CatalogController.createErrorResponse('Only sandbox orders can be moved', 409);
            const client = cjClientFromEnv(env);
            const order = await new CatalogOrderService(env).getOrder(orderId);
            if (!client || !order) return CatalogController.createErrorResponse('Order not found', 404);
            const supplierOrderIds = [...new Set(order.items.flatMap((item) => (item.supplierOrderId ? [item.supplierOrderId] : [])))];
            for (const supplierOrderId of supplierOrderIds) {
                for (const move of sandboxMoves(action)) {
                    if (move.kind === 'status') await client.sandboxUpdateStatus(supplierOrderId, move.status);
                    else await client.sandboxUpdateTrackNumber(supplierOrderId, `SBX${Date.now()}`);
                }
            }
            await CatalogController.runner(env, orderId).signal();
            return CatalogController.createSuccessResponse({ moved: supplierOrderIds });
        } catch (error) {
            return CatalogController.handleError(error, 'move a sandbox order') as ControllerResponse<ApiResponse<{ moved: string[] }>>;
        }
    }
```

Routes in `catalogRoutes.ts`:

```ts
    app.get('/api/admin/catalog/orders/:id/runner', setAuthLevel(AuthConfig.admin), adaptController(CatalogController, CatalogController.runnerSnapshot));
    app.post('/api/admin/catalog/orders/:id/sync', setAuthLevel(AuthConfig.admin), adaptController(CatalogController, CatalogController.syncNow));
    app.post('/api/admin/catalog/orders/:id/retry', setAuthLevel(AuthConfig.admin), adaptController(CatalogController, CatalogController.retryOrder));
    app.post('/api/admin/catalog/orders/:id/sandbox', setAuthLevel(AuthConfig.admin), adaptController(CatalogController, CatalogController.sandboxMove));
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run worker/services/catalog/sandbox.test.ts worker/api/controllers/catalog`
Expected: PASS.
Run: `npx tsc --noEmit -p tsconfig.worker.json`
Expected: no errors outside `packages/artifacts-viewer`.

- [ ] **Step 5: Commit**

```bash
git add worker/services/catalog/sandbox.ts worker/services/catalog/sandbox.test.ts worker/api/controllers/catalog worker/api/routes/catalogRoutes.ts
git commit -m "feat(catalog): admin runner controls and sandbox order moves

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Not in this plan

- **CJ webhooks** (`/api/catalog/webhooks/cjdropshipping`, signature checks, registration): CJ refuses localhost callbacks, so local runs can't receive them. The runner polls its order every 30 minutes until delivery, and admins can sync now. Ruling in the ledger.
- **`catalog_supplier_orders` and the hourly reconciliation cron:** the CJ order id lives on each catalog item, and each runner polls its own order. What CJ charged is in CJ's dashboard. Ruling in the ledger.
- **Alert emails, the seller digest, daily health and the admin page:** alerts are logged at error level for now; the owner reads them in Workers logs.
- **`refundUnplaced` and supplier dispute sync:** the owner refunds through Stripe and the admin retry until the admin page exists.
- **The crons' work beyond the 15-minute refresh:** `5 * * * *` and `35 6 * * *` are declared so the config lands once, as the spec asks; their jobs (reconciliation, health) arrive with the alerts follow-up and are ignored by `runCatalogSchedule` until then.
