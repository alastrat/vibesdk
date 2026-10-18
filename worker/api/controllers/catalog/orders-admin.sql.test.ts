/**
 * The admin catalog-order endpoints on real SQL, with each order's runner stood in: the list's views and paging, and one
 * order with where its runner stands. Each test's writes are rolled back after it.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertApp, insertStoreOrder, insertUser, migratedD1 } from '../../../database/test-support/real-d1';
import { CatalogController } from './controller';
import type { RouteContext } from '../../types/route-context';
import type { RunnerState } from '../../../services/catalog/runner';

const NOW = Date.now();
let db: D1Database;
let orderNumber = 0;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'seller_1');
	await insertApp(db, { id: 'app_tea', userId: 'seller_1', title: 'Northwind Tea' });
});

async function catalogOrder(id: string, status: string, mode: 'test' | 'live'): Promise<void> {
	const at = Math.floor(NOW / 1000);
	await db
		.prepare(
			`INSERT INTO catalog_orders (id, seller_user_id, store_app_id, stripe_checkout_session_id, stripe_payment_intent_id, status, total_cents, catalog_total_cents, application_fee_cents, destination_country, shipping_address, created_at, updated_at)
			 VALUES (?, 'seller_1', 'app_tea', ?, ?, ?, 4099, 2028, 2249, 'US', '{"name":"Ana Ruiz","line1":"12 Elm St","line2":null,"city":"Austin","region":"TX","postalCode":"78701","countryCode":"US","phone":null,"email":null}', ?, ?)`,
		)
		.bind(id, `cs_${id}`, `pi_${id}`, status, at, at)
		.run();
	await insertStoreOrder(db, { id: `ord_${id}`, sellerUserId: 'seller_1', mode, orderNumber: (orderNumber += 1), totalCents: 4099, checkoutSessionId: `cs_${id}`, createdAt: new Date(NOW) });
}

/** Each order's runner answers this snapshot, or fails to. */
function runners(snapshot: RunnerState | null | Error) {
	return {
		idFromName: (name: string) => name,
		get: () => ({
			snapshot: async () => {
				if (snapshot instanceof Error) throw snapshot;
				return snapshot;
			},
		}),
	};
}

const context = (pathParams: Record<string, string> = {}) => ({ pathParams }) as unknown as RouteContext;

async function list(query: string) {
	const response = await CatalogController.listOrders(new Request(`https://estori.app/api/admin/catalog/orders${query}`), envWith(db), {} as ExecutionContext, context());
	return { status: response.status, body: (await response.json()) as { data?: { orders: Array<{ id: string }>; nextCursor: string | null } } };
}

async function detail(id: string, snapshot: RunnerState | null | Error, extra: Record<string, unknown> = {}) {
	const env = envWith(db, { CATALOG_ORDER_RUNNER: runners(snapshot), ...extra });
	const response = await CatalogController.orderDetail(new Request(`https://estori.app/api/admin/catalog/orders/${id}`), env, {} as ExecutionContext, context({ id }));
	return { status: response.status, body: (await response.json()) as { data?: Record<string, unknown> } };
}

describe('the admin catalog orders list', () => {
	it('shows the orders that need someone unless asked for all of them', async () => {
		await catalogOrder('stuck', 'needs-attention', 'test');
		await catalogOrder('done', 'placement-done', 'test');
		expect((await list('')).body.data?.orders.map((order) => order.id)).toEqual(['stuck']);
		expect((await list('?view=all')).body.data?.orders.map((order) => order.id).sort()).toEqual(['done', 'stuck']);
	});

	it('refuses a view or cursor it does not know', async () => {
		expect((await list('?view=late')).status).toBe(400);
		expect((await list('?view=all&cursor=garbage')).status).toBe(400);
	});
});

describe('one catalog order for admins', () => {
	const state: RunnerState = { orderId: 'held', placement: 'risk-hold', nextPlacementAt: NOW, refundFailures: 1, nextRefundAt: 0, nextSyncAt: NOW + 60_000, startedAt: NOW - 60_000, riskChecked: true, riskHoldUntil: NOW + 86_400_000 };

	it("answers the order with where its runner stands, and the raw state for debugging", async () => {
		await catalogOrder('held', 'risk-hold', 'test');
		const { status, body } = await detail('held', state);
		expect(status).toBe(200);
		expect(body.data).toMatchObject({ id: 'held', status: 'risk-hold', mode: 'test', storeTitle: 'Northwind Tea', shipTo: { city: 'Austin' }, sandbox: true });
		expect(body.data?.runner).toEqual({
			placement: 'risk-hold',
			nextPlacementAt: null,
			nextSyncAt: new Date(NOW + 60_000).toISOString(),
			riskHoldUntil: new Date(NOW + 86_400_000).toISOString(),
			refundFailures: 1,
			raw: JSON.stringify(state, null, 2),
		});
	});

	it('names the next placement only while one is due', async () => {
		await catalogOrder('due', 'awaiting-placement', 'test');
		const { body } = await detail('due', { ...state, orderId: 'due', placement: 'due', riskHoldUntil: null, nextSyncAt: null });
		expect(body.data?.runner).toMatchObject({ placement: 'due', nextPlacementAt: new Date(NOW).toISOString(), nextSyncAt: null, riskHoldUntil: null });
	});

	it("still answers the order when its runner can't be read, or has no state", async () => {
		await catalogOrder('quiet', 'placement-done', 'test');
		expect((await detail('quiet', new Error('Durable Object reset'))).body.data).toMatchObject({ id: 'quiet', runner: null });
		expect((await detail('quiet', null)).body.data).toMatchObject({ id: 'quiet', runner: null });
	});

	it('offers sandbox moves only for orders the supplier sandbox takes', async () => {
		await catalogOrder('live-sale', 'placement-done', 'live');
		expect((await detail('live-sale', null, { ENVIRONMENT: 'prod', CATALOG_SUPPLIER_LIVE: 'true' })).body.data).toMatchObject({ mode: 'live', sandbox: false });
	});

	it("answers not found for an order it doesn't have", async () => {
		expect((await detail('missing', null)).status).toBe(404);
	});
});
