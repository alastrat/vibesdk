/** The seller's record, for their level, on real SQL. */

import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertCatalogOrder, insertDispute, insertStoreOrder, insertUser, migratedD1 } from '../test-support/real-d1';
import { StoreOrderService } from './StoreOrderService';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const ago = (days: number): Date => new Date(NOW - days * DAY);
let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'u1');
	// Completed: paid, old enough, nothing undelivered.
	await insertStoreOrder(db, { id: 'ord_done', sellerUserId: 'u1', orderNumber: 1, totalCents: 2000, createdAt: ago(20), checkoutSessionId: 'cs_done' });
	await insertCatalogOrder(db, { id: 'co_done', sellerUserId: 'u1', checkoutSessionId: 'cs_done', itemStatus: 'delivered', createdAt: ago(20) });
	// Not completed: too recent, refunded, a catalog item still in transit, or disputed even though the seller won.
	await insertStoreOrder(db, { id: 'ord_new', sellerUserId: 'u1', orderNumber: 2, totalCents: 2000, createdAt: ago(5) });
	await insertStoreOrder(db, { id: 'ord_refunded', sellerUserId: 'u1', orderNumber: 3, totalCents: 2000, paymentStatus: 'refunded', createdAt: ago(20) });
	await insertStoreOrder(db, { id: 'ord_shipping', sellerUserId: 'u1', orderNumber: 4, totalCents: 2000, createdAt: ago(20), checkoutSessionId: 'cs_shipping' });
	await insertCatalogOrder(db, { id: 'co_shipping', sellerUserId: 'u1', checkoutSessionId: 'cs_shipping', itemStatus: 'shipped', createdAt: ago(20) });
	await insertStoreOrder(db, { id: 'ord_won', sellerUserId: 'u1', orderNumber: 5, totalCents: 2000, createdAt: ago(20) });
	await insertDispute(db, { id: 'dp_won', orderId: 'ord_won', status: 'won', createdAt: ago(15), closedAt: ago(3) });
	// A dispute opened 100 days ago and lost 10 days ago: a loss in the window, outside the rate's.
	await insertStoreOrder(db, { id: 'ord_lost', sellerUserId: 'u1', orderNumber: 6, totalCents: 2000, paymentStatus: 'dispute_lost', createdAt: ago(120) });
	await insertDispute(db, { id: 'dp_lost', orderId: 'ord_lost', status: 'lost', createdAt: ago(100), closedAt: ago(10) });
	// An inquiry takes no money and isn't a chargeback.
	await insertDispute(db, { id: 'dp_inquiry', orderId: 'ord_new', status: 'warning_closed', createdAt: ago(4), closedAt: ago(2) });
	// Live mode counts on its own.
	await insertStoreOrder(db, { id: 'ord_live', sellerUserId: 'u1', mode: 'live', orderNumber: 1, totalCents: 2000, createdAt: ago(200) });
});

describe('StoreOrderService.sellerRecord on real SQL', () => {
	it('counts completed orders, 90 days of orders and chargebacks, and losses by the day they were lost, in one mode', async () => {
		expect(await new StoreOrderService(envWith(db)).sellerRecord('u1', 'test', NOW)).toEqual({
			firstSaleAt: ago(120),
			completedOrders: 1,
			ordersLast90Days: 5,
			disputesLast90Days: 1,
			lostDisputesLast90Days: 1,
		});
	});
});
