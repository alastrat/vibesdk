import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertStoreOrder, insertUser, migratedD1 } from '../test-support/real-d1';
import { StoreOrderService } from './StoreOrderService';

let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'count_1');
});

describe("a seller's order count", () => {
	it('counts the orders of one mode, so the first live sale is first even after test sales', async () => {
		const orders = new StoreOrderService(envWith(db));
		expect(await orders.sellerOrderCount('count_1', 'live')).toBe(0);
		await insertStoreOrder(db, { id: 'ord_t1', sellerUserId: 'count_1', mode: 'test', orderNumber: 1, totalCents: 1_000, createdAt: new Date() });
		await insertStoreOrder(db, { id: 'ord_t2', sellerUserId: 'count_1', mode: 'test', orderNumber: 2, totalCents: 1_000, createdAt: new Date() });
		await insertStoreOrder(db, { id: 'ord_l1', sellerUserId: 'count_1', mode: 'live', orderNumber: 1, totalCents: 1_000, createdAt: new Date() });
		expect(await orders.sellerOrderCount('count_1', 'test')).toBe(2);
		expect(await orders.sellerOrderCount('count_1', 'live')).toBe(1);
	});
});
