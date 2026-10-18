/**
 * A seller's own store orders on real SQL: the list's views and filters, one order's facts, and marking it shipped.
 * Each test's writes are rolled back after it.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertApp, insertUser, migratedD1 } from '../test-support/real-d1';
import { SellerOrderService } from './SellerOrderService';

let db: D1Database;
const NOW = new Date(1_800_000_000_000);
const HOUR = 60 * 60 * 1000;
const at = (hoursAgo: number) => Math.floor((NOW.getTime() - hoursAgo * HOUR) / 1000);
let numbers = 0;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'seller_1');
	await insertUser(db, 'seller_2');
	await insertApp(db, { id: 'app_tea', userId: 'seller_1', title: 'Northwind Tea' });
	await insertApp(db, { id: 'app_home', userId: 'seller_1', title: 'Lumen Home' });
});

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

describe('seller orders on real SQL', () => {
	it("records when an order shipped, and lists a seller's orders by date from one index", async () => {
		const table = await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'store_orders'").first<{ sql: string }>();
		expect(table?.sql).toContain('`shipped_at` integer');
		const indexes = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'store_orders'").all<{ name: string }>();
		const names = indexes.results.map((row) => row.name);
		expect(names).toContain('store_orders_seller_created_idx');
		expect(names).not.toContain('store_orders_seller_idx');
	});

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

	it("reads an order's shipment, refunded lines, latest dispute and store, for its seller only", async () => {
		await sale({ id: 'facts', hoursAgo: 1, payment: 'disputed', lines: [['own', 1, true], ['own', 1]] });
		await db
			.prepare(`INSERT INTO store_disputes (id, order_id, amount_cents, reason, status, created_at, updated_at) VALUES ('dp_old', 'facts', 500, 'fraudulent', 'won', ?, ?), ('dp_new', 'facts', 4000, 'fraudulent', 'needs_response', ?, ?)`)
			.bind(at(5), at(5), at(1), at(1))
			.run();
		const service = new SellerOrderService(envWith(db));
		expect(await service.orderFacts('seller_1', 'facts')).toEqual({ storeTitle: 'Northwind Tea', carrier: null, trackingNumber: null, shippedAt: null, refundedLineNos: [1], pendingRefundLineNos: [], dispute: { amountCents: 4000, status: 'needs_response' } });
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

	it('treats a refund claimed but never made as pending: the line still counts to ship, can be shipped, and reads as pending', async () => {
		await sale({ id: 'pending', hoursAgo: 1, lines: [['own', 1]] });
		await db
			.prepare(`INSERT INTO store_refunds (id, order_id, line_no, amount_cents, request_id, initiated_by, stripe_refund_id, created_at) VALUES ('rf_pending', 'pending', 1, 1000, 'req', 'seller', NULL, ?)`)
			.bind(at(0))
			.run();
		const service = new SellerOrderService(envWith(db));
		expect(await ids()).toEqual(['pending']);
		expect((await service.listOrders({ sellerUserId: 'seller_1', view: 'all', mode: 'live' })).orders[0]).toMatchObject({ ownUnits: 1 });
		expect(await service.orderFacts('seller_1', 'pending')).toMatchObject({ refundedLineNos: [], pendingRefundLineNos: [1] });
		expect(await service.setShipment({ sellerUserId: 'seller_1', orderId: 'pending', shipment: { carrier: null, trackingNumber: null }, now: NOW })).toBe('updated');
	});
});

