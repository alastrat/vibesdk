/**
 * The admin view of catalog orders on real SQL: which orders need someone, paging through them, and one order with its
 * store, seller, sale and items. Each test's writes are rolled back after it.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertApp, insertStoreOrder, insertUser, migratedD1 } from '../test-support/real-d1';
import { CatalogOrderAdminService } from './CatalogOrderAdminService';
import type { ShippingAddress } from '../../../shared/types/catalog';

const NOW = new Date(1_800_000_000_000);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const LATE = { placedBefore: new Date(NOW.getTime() - 5 * DAY), shippedBefore: new Date(NOW.getTime() - 30 * DAY) };
const ADDRESS: ShippingAddress = { name: 'Ana Ruiz', line1: '12 Elm St', line2: null, city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US', phone: null, email: 'ana@example.test' };
const seconds = (at: Date): number => Math.floor(at.getTime() / 1000);
let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'seller_1');
	await insertApp(db, { id: 'app_tea', userId: 'seller_1', title: 'Northwind Tea' });
});

/** A catalog order for Northwind Tea, created `hoursAgo`, with items in these statuses since `daysAgo`. */
async function catalogOrder(order: { id: string; hoursAgo: number; status?: string; lastError?: string; items: Array<{ status: string; daysAgo?: number; tracking?: string }> }): Promise<void> {
	const createdAt = new Date(NOW.getTime() - order.hoursAgo * HOUR);
	await db
		.prepare(
			`INSERT INTO catalog_orders (id, seller_user_id, store_app_id, stripe_checkout_session_id, stripe_payment_intent_id, status, total_cents, catalog_total_cents, application_fee_cents, destination_country, shipping_address, placement_attempts, last_error, created_at, updated_at)
			 VALUES (?, 'seller_1', 'app_tea', ?, ?, ?, 4099, 2028, 2249, 'US', ?, 1, ?, ?, ?)`,
		)
		.bind(order.id, `cs_${order.id}`, `pi_${order.id}`, order.status ?? 'placement-done', JSON.stringify(ADDRESS), order.lastError ?? null, seconds(createdAt), seconds(createdAt))
		.run();
	for (const [index, item] of order.items.entries()) {
		await db
			.prepare(
				`INSERT INTO catalog_order_items (id, order_id, catalog_variant_id, supplier, supplier_variant_id, quantity, unit_price_cents, catalog_price_cents, status, supplier_order_id, tracking_number, carrier, updated_at)
				 VALUES (?, ?, ?, 'cjdropshipping', 'cj_1', 1, 4099, 2028, ?, 'SD1001', ?, ?, ?)`,
			)
			.bind(`${order.id}_${index}`, order.id, `cv_${index}`, item.status, item.tracking ?? null, item.tracking ? 'USPS' : null, seconds(new Date(NOW.getTime() - (item.daysAgo ?? 0) * DAY)))
			.run();
	}
}

async function listIds(view: 'attention' | 'all'): Promise<string[]> {
	const page = await new CatalogOrderAdminService(envWith(db)).listOrders({ view, late: LATE });
	return page.orders.map((order) => order.id);
}

describe('catalog orders for admins, on real SQL', () => {
	it('lists the orders that need someone, newest first: stuck, risk-held, an item held back, or an item late to ship or arrive', async () => {
		await catalogOrder({ id: 'fresh', hoursAgo: 1, items: [{ status: 'placed', daysAgo: 1 }] });
		await catalogOrder({ id: 'stuck', hoursAgo: 2, status: 'needs-attention', lastError: 'Out of stock', items: [{ status: 'pending' }] });
		await catalogOrder({ id: 'risky', hoursAgo: 3, status: 'risk-hold', items: [{ status: 'pending' }] });
		await catalogOrder({ id: 'held-back', hoursAgo: 4, items: [{ status: 'withheld' }] });
		await catalogOrder({ id: 'not-shipped', hoursAgo: 5, items: [{ status: 'placed', daysAgo: 6 }] });
		await catalogOrder({ id: 'not-delivered', hoursAgo: 6, items: [{ status: 'delivered', daysAgo: 40 }, { status: 'shipped', daysAgo: 31 }] });
		await catalogOrder({ id: 'in-transit', hoursAgo: 7, items: [{ status: 'shipped', daysAgo: 10 }] });
		await catalogOrder({ id: 'delivered', hoursAgo: 8, items: [{ status: 'delivered', daysAgo: 60 }] });
		expect(await listIds('attention')).toEqual(['stuck', 'risky', 'held-back', 'not-shipped', 'not-delivered']);
		expect(await listIds('all')).toEqual(['fresh', 'stuck', 'risky', 'held-back', 'not-shipped', 'not-delivered', 'in-transit', 'delivered']);
	});

	it('pages through orders created in the same second without skipping or repeating one', async () => {
		for (const id of ['a', 'b', 'c', 'd', 'e']) await catalogOrder({ id, hoursAgo: 1, items: [{ status: 'placed' }] });
		const service = new CatalogOrderAdminService(envWith(db));
		const seen: string[] = [];
		let cursor: string | null = null;
		do {
			const page = await service.listOrders({ view: 'all', late: LATE, cursor, limit: 2 });
			seen.push(...page.orders.map((order) => order.id));
			cursor = page.nextCursor;
		} while (cursor);
		expect(seen).toEqual(['e', 'd', 'c', 'b', 'a']);
	});

	it("refuses a cursor it didn't make", async () => {
		await expect(new CatalogOrderAdminService(envWith(db)).listOrders({ view: 'all', late: LATE, cursor: 'garbage' })).rejects.toThrow('Invalid cursor');
	});

	it("names each order's store, seller and sale, and counts its items by status", async () => {
		await catalogOrder({ id: 'multi', hoursAgo: 1, items: [{ status: 'shipped', tracking: '9400111' }, { status: 'shipped', tracking: '9400112' }, { status: 'placed' }] });
		await insertStoreOrder(db, { id: 'ord_7', sellerUserId: 'seller_1', mode: 'live', orderNumber: 7, totalCents: 12297, refundedCents: 4099, checkoutSessionId: 'cs_multi', createdAt: NOW });
		const [row] = (await new CatalogOrderAdminService(envWith(db)).listOrders({ view: 'all', late: LATE })).orders;
		expect(row).toEqual({
			id: 'multi',
			createdAt: new Date(NOW.getTime() - HOUR).toISOString(),
			status: 'placement-done',
			mode: 'live',
			orderNumber: 7,
			storeAppId: 'app_tea',
			storeTitle: 'Northwind Tea',
			sellerEmail: 'seller_1@example.test',
			itemCounts: { shipped: 2, placed: 1 },
			lastError: null,
		});
	});

	it('shows one order with its money, refunds, address and items by their names on the store order', async () => {
		await catalogOrder({ id: 'multi', hoursAgo: 1, items: [{ status: 'shipped', tracking: '9400111' }, { status: 'placed' }] });
		await insertStoreOrder(db, { id: 'ord_7', sellerUserId: 'seller_1', mode: 'live', orderNumber: 7, totalCents: 12297, refundedCents: 4099, checkoutSessionId: 'cs_multi', createdAt: NOW });
		await db
			.prepare(`INSERT INTO store_order_items (order_id, line_no, kind, product_id, variant_id, name, quantity, unit_price_cents, catalog_variant_id, locked_catalog_price_cents) VALUES ('ord_7', 2, 'catalog', 'feeder', 'feeder-blue', 'Bird feeder, Blue', 1, 4099, 'cv_0', 2028)`)
			.run();
		const detail = await new CatalogOrderAdminService(envWith(db)).getOrder('multi');
		expect(detail).toMatchObject({
			id: 'multi',
			status: 'placement-done',
			mode: 'live',
			orderNumber: 7,
			storeTitle: 'Northwind Tea',
			sellerUserId: 'seller_1',
			sellerEmail: 'seller_1@example.test',
			stripePaymentIntentId: 'pi_multi',
			currency: 'usd',
			totalCents: 4099,
			catalogTotalCents: 2028,
			applicationFeeCents: 2249,
			refundedCents: 4099,
			shipTo: ADDRESS,
			placementAttempts: 1,
			lastError: null,
		});
		expect(detail?.items).toEqual([
			{ id: 'multi_0', name: 'Bird feeder, Blue', catalogVariantId: 'cv_0', quantity: 1, unitPriceCents: 4099, catalogPriceCents: 2028, status: 'shipped', supplierOrderId: 'SD1001', trackingNumber: '9400111', carrier: 'USPS', supplierRefunded: false },
			{ id: 'multi_1', name: null, catalogVariantId: 'cv_1', quantity: 1, unitPriceCents: 4099, catalogPriceCents: 2028, status: 'placed', supplierOrderId: 'SD1001', trackingNumber: null, carrier: null, supplierRefunded: false },
		]);
	});

	it("finds no order for an id it doesn't have", async () => {
		expect(await new CatalogOrderAdminService(envWith(db)).getOrder('missing')).toBeNull();
	});
});
