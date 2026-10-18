/** The seller orders API on real SQL: the list, one order, and its shipment, for the order's seller only. */

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
/** A request's context that keeps what it was asked to finish after answering. */
function requestContext() {
	const later: Array<Promise<unknown>> = [];
	const ctx = { waitUntil: (promise: Promise<unknown>) => void later.push(promise), passThroughOnException: () => undefined } as unknown as ExecutionContext;
	return { ctx, later };
}
const json = async (response: Response) => ({ status: response.status, body: (await response.json()) as { data?: Record<string, unknown>; error?: unknown } });

describe('the seller orders API', () => {
	it('lists the signed-in seller orders to ship, and refuses a view, mode or cursor it does not know', async () => {
		const list = (query: string) => SellerOrdersController.list(new Request(`https://estori.app/api/orders${query}`), envWith(db), {} as ExecutionContext, as('seller_1'));
		expect((await json(await list(''))).body.data).toMatchObject({ orders: [{ id: 'ord_1', ownUnits: 2 }] });
		for (const query of ['?view=late', '?mode=test', '?cursor=garbage']) expect((await list(query)).status, query).toBe(400);
	});

	it('answers one order to its seller and not found to anyone else', async () => {
		const detail = (userId: string) => SellerOrdersController.detail(new Request('https://estori.app/api/orders/ord_1'), envWith(db), {} as ExecutionContext, as(userId, { id: 'ord_1' }));
		expect((await json(await detail('seller_1'))).body.data).toMatchObject({ id: 'ord_1', storeTitle: 'Northwind Tea', items: [{ lineNo: 1, refunded: false }] });
		expect((await detail('seller_2')).status).toBe(404);
	});

	it('marks the order shipped and answers it, refuses a bad body, and refuses an order with nothing the seller ships', async () => {
		const request = requestContext();
		const ship = (body: unknown, orderId = 'ord_1') =>
			SellerOrdersController.shipment(
				new Request(`https://estori.app/api/orders/${orderId}/shipment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
				envWith(db),
				request.ctx,
				as('seller_1', { id: orderId }),
			);
		const shipped = await json(await ship({ shipped: true, carrier: 'ups', trackingNumber: '1Z999' }));
		expect(shipped.body.data).toMatchObject({ id: 'ord_1', fulfillmentStatus: 'fulfilled', carrier: 'UPS', trackingNumber: '1Z999' });
		expect((await ship({ shipped: true, carrier: 'pigeon' })).status).toBe(400);
		expect((await ship({ shipped: true, carrier: null }, 'missing')).status).toBe(404);
		await db.prepare(`UPDATE store_order_items SET kind = 'catalog', catalog_variant_id = 'cv_1' WHERE order_id = 'ord_1'`).run();
		expect((await ship({ shipped: true, carrier: null })).status).toBe(409);
		await Promise.all(request.later);
	});

	it('emails the shopper once when the seller ships, about the items the seller ships that were not refunded', async () => {
		const at = Math.floor(Date.now() / 1000);
		await db
			.prepare(`INSERT INTO store_orders (id, mode, app_id, order_number, checkout_id, seller_user_id, customer_email, subtotal_cents, shipping_cents, total_cents, application_fee_cents, created_at, updated_at) VALUES ('ord_2', 'live', 'app_tea', 2, 'chk_2', 'seller_1', 'ana@example.test', 4000, 0, 4000, 400, ?, ?)`)
			.bind(at, at)
			.run();
		await db
			.prepare(
				`INSERT INTO store_order_items (order_id, line_no, kind, product_id, variant_id, name, quantity, unit_price_cents, catalog_variant_id) VALUES ('ord_2', 1, 'own', 'tea', 'tea-50', 'Oolong', 1, 1000, NULL), ('ord_2', 2, 'own', 'tea', 'tea-90', 'Sencha', 1, 1000, NULL), ('ord_2', 3, 'catalog', 'pot', 'pot-1', 'Teapot', 1, 2000, 'cv_pot')`,
			)
			.run();
		await db.prepare(`INSERT INTO store_refunds (id, order_id, line_no, amount_cents, request_id, initiated_by, stripe_refund_id, created_at) VALUES ('sr_2_2', 'ord_2', 2, 1000, 'req_00000002', 'seller', 're_2', ?)`).bind(at).run();
		const request = requestContext();
		const ship = (body: unknown) =>
			SellerOrdersController.shipment(
				new Request('https://estori.app/api/orders/ord_2/shipment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
				envWith(db),
				request.ctx,
				as('seller_1', { id: 'ord_2' }),
			);
		const emails = async () => (await db.prepare(`SELECT kind, event_key, payload FROM shopper_emails WHERE order_id = 'ord_2'`).all<{ kind: string; event_key: string; payload: string }>()).results;

		expect((await ship({ shipped: false })).status).toBe(200);
		expect(await emails()).toEqual([]);
		expect((await ship({ shipped: true, carrier: 'usps', trackingNumber: '9400 1' })).status).toBe(200);
		// The email is written before the answer, and sent after it.
		expect(request.later).toHaveLength(1);
		await Promise.all(request.later);
		expect((await ship({ shipped: false })).status).toBe(200);
		expect((await ship({ shipped: true, carrier: 'ups', trackingNumber: '1Z9' })).status).toBe(200);
		const sent = await emails();
		expect(sent.map((email) => [email.kind, email.event_key])).toEqual([['order_shipped', 'own']]);
		expect(JSON.parse(sent[0].payload)).toEqual({ lineNos: [1], carrier: 'USPS', trackingNumber: '9400 1' });
	});

	it("refunds through the seller's own order, whatever happened to its store, and answers not found to another seller", async () => {
		const refund = (userId: string, body: unknown) =>
			SellerOrdersController.refund(
				new Request('https://estori.app/api/orders/ord_1/refunds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
				envWith(db),
				{} as ExecutionContext,
				as(userId, { id: 'ord_1' }),
			);
		expect((await refund('seller_2', { lineNos: [1], requestId: 'req_00000001' })).status).toBe(404);
		expect((await refund('seller_1', { lineNos: 'all' })).status).toBe(400);
		// The seller owns the order, so it reaches the refund itself: this test env has no Stripe key.
		const answer = await json(await refund('seller_1', { lineNos: [1], requestId: 'req_00000001' }));
		expect(answer.status).toBe(400);
		expect(JSON.stringify(answer.body)).toContain("Payments aren't set up");
	});
});

