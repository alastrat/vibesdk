/**
 * The money statements on real SQL: claims that only succeed once, and the refund total they add up to. Each test's
 * writes are rolled back after it, so every test sets up what it reads.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertCheckout, insertStoreOrder, insertUser, migratedD1 } from '../test-support/real-d1';
import { StoreCheckoutService } from './StoreCheckoutService';
import { SellerChargeService } from './SellerChargeService';
import { StoreOrderService } from './StoreOrderService';
import { StoreRefundService } from './StoreRefundService';

const NOW = new Date(1_800_000_000_000);
let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'u1');
	await insertStoreOrder(db, { id: 'ord_1', sellerUserId: 'u1', orderNumber: 1, totalCents: 5000, createdAt: NOW });
	await insertStoreOrder(db, { id: 'ord_2', sellerUserId: 'u1', orderNumber: 2, totalCents: 3000, createdAt: NOW });
	await insertStoreOrder(db, { id: 'ord_3', sellerUserId: 'u1', orderNumber: 3, totalCents: 3000, createdAt: NOW });
});

describe('claims on real SQL', () => {
	it("collects a charge only while that much is owed, so two sales can't both take it", async () => {
		const charges = new SellerChargeService(envWith(db));
		await charges.add({ sellerUserId: 'u1', kind: 'dispute-fee', sourceId: 'dp_1', amountCents: 1500, now: NOW });
		const [charge] = await charges.open('u1');
		expect(await charges.claimCollection({ chargeId: charge.id, orderId: 'ord_2', amountCents: 1500, now: NOW })).toBe(true);
		expect(await charges.claimCollection({ chargeId: charge.id, orderId: 'ord_3', amountCents: 1500, now: NOW })).toBe(false);
		expect(await charges.open('u1')).toEqual([]);
		await charges.releaseClaim({ chargeId: charge.id, orderId: 'ord_2' });
		expect(await charges.open('u1')).toEqual([{ id: charge.id, amountCents: 1500, collectedCents: 0 }]);
	});

	it('claims a refund line once, returning the first claim to a second request', async () => {
		const refunds = new StoreRefundService(envWith(db));
		const first = await refunds.claimRefund({ orderId: 'ord_1', lineNo: 1, requestId: 'rq_1', initiatedBy: 'seller', amountCents: 5000, reversalCents: 4000, now: NOW });
		const second = await refunds.claimRefund({ orderId: 'ord_1', lineNo: 1, requestId: 'rq_2', initiatedBy: 'seller', amountCents: 5000, reversalCents: 5000, now: NOW });
		expect(second).toEqual(first);
		expect(first).toMatchObject({ requestId: 'rq_1', reversalCents: 4000, stripeRefundId: null });
	});

	it("totals only refunds Stripe made, and marks the order's status from them", async () => {
		const orders = new StoreOrderService(envWith(db));
		await new StoreRefundService(envWith(db)).claimRefund({ orderId: 'ord_1', lineNo: 1, requestId: 'rq_1', initiatedBy: 'seller', amountCents: 5000, reversalCents: 5000, now: NOW });
		await orders.applyRefunds('ord_1', NOW);
		expect(await orders.getOrder('ord_1')).toMatchObject({ refundedCents: 0, paymentStatus: 'paid' });
		await new StoreRefundService(envWith(db)).completeRefund({ orderId: 'ord_1', lineNo: 1, stripeRefundId: 're_1' });
		await orders.applyRefunds('ord_1', NOW);
		expect(await orders.getOrder('ord_1')).toMatchObject({ refundedCents: 5000, paymentStatus: 'refunded' });
	});

	it("sums the week's paid, open and starting checkouts in one mode toward the cap", async () => {
		const week = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
		for (const [id, status, weightedCents, daysAgo, mode] of [
			['chk_paid', 'completed', 8600, 1, 'test'],
			['chk_open', 'open', 4599, 0, 'test'],
			['chk_starting', 'creating', 1000, 0, 'test'],
			['chk_expired', 'expired', 50_000, 1, 'test'],
			['chk_old', 'completed', 50_000, 8, 'test'],
			['chk_live', 'completed', 50_000, 1, 'live'],
		] as const) {
			await insertCheckout(db, { id, sellerUserId: 'u1', status, weightedCents, mode, createdAt: new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000) });
		}
		expect(await new StoreCheckoutService(envWith(db)).weeklyUsage('u1', 'test', week)).toBe(8600 + 4599 + 1000);
	});

	it("estimates payout volume from this mode's paid sales only, net of refunds", async () => {
		const day = 24 * 60 * 60 * 1000;
		await insertStoreOrder(db, { id: 'ord_part', sellerUserId: 'u1', orderNumber: 10, totalCents: 4000, paymentStatus: 'partially_refunded', refundedCents: 1000, createdAt: NOW });
		await insertStoreOrder(db, { id: 'ord_disputed', sellerUserId: 'u1', orderNumber: 11, totalCents: 9000, paymentStatus: 'disputed', createdAt: NOW });
		await insertStoreOrder(db, { id: 'ord_live', sellerUserId: 'u1', mode: 'live', orderNumber: 1, totalCents: 9000, createdAt: NOW });
		// ord_1 to ord_3 are paid test orders of 5000, 3000 and 3000 with no fee.
		expect(await new StoreOrderService(envWith(db)).salesVolumeSince('u1', 'test', new Date(NOW.getTime() - 30 * day))).toBe(5000 + 3000 + 3000 + 3000);
	});

	it("expires only this store's starting or open checkout for a replacement, and returns its session", async () => {
		const checkouts = new StoreCheckoutService(envWith(db));
		await insertCheckout(db, { id: 'chk_open', sellerUserId: 'u1', status: 'open', weightedCents: 4599, createdAt: NOW });
		await db.prepare("UPDATE store_checkouts SET stripe_checkout_session_id = 'cs_open' WHERE id = 'chk_open'").run();
		await insertCheckout(db, { id: 'chk_paid', sellerUserId: 'u1', status: 'completed', weightedCents: 4599, createdAt: NOW });
		expect(await checkouts.replaceOpen('chk_open', 'app_other')).toBeNull();
		expect(await checkouts.replaceOpen('chk_paid', 'app_1')).toBeNull();
		expect(await checkouts.replaceOpen('chk_open', 'app_1')).toEqual({ sessionId: 'cs_open' });
		expect(await checkouts.replaceOpen('chk_open', 'app_1')).toBeNull();
		expect(await checkouts.weeklyUsage('u1', 'test', new Date(NOW.getTime() - 1000))).toBe(4599);
	});
});
