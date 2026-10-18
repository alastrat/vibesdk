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
		const ship = (body: unknown, orderId = 'ord_1') =>
			SellerOrdersController.shipment(
				new Request(`https://estori.app/api/orders/${orderId}/shipment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
				envWith(db),
				{} as ExecutionContext,
				as('seller_1', { id: orderId }),
			);
		const shipped = await json(await ship({ shipped: true, carrier: 'ups', trackingNumber: '1Z999' }));
		expect(shipped.body.data).toMatchObject({ id: 'ord_1', fulfillmentStatus: 'fulfilled', carrier: 'UPS', trackingNumber: '1Z999' });
		expect((await ship({ shipped: true, carrier: 'pigeon' })).status).toBe(400);
		expect((await ship({ shipped: true, carrier: null }, 'missing')).status).toBe(404);
		await db.prepare(`UPDATE store_order_items SET kind = 'catalog', catalog_variant_id = 'cv_1' WHERE order_id = 'ord_1'`).run();
		expect((await ship({ shipped: true, carrier: null })).status).toBe(409);
	});
});
