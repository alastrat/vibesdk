import { describe, expect, it } from 'vitest';
import { StoreOrderService } from './StoreOrderService';
import { recordingD1 } from '../test-support/recording-d1';
import type { NewStoreOrder } from '../../services/store-payments/store';

const ORDER: NewStoreOrder = {
	id: 'ord_1',
	checkoutId: 'chk_1',
	mode: 'test',
	appId: 'app_1',
	sellerUserId: 'u1',
	sellerStripeAccountId: 'acct_1',
	storeVersionId: null,
	stripeCheckoutSessionId: 'cs_1',
	stripePaymentIntentId: 'pi_1',
	subtotalCents: 4000,
	shippingCents: 600,
	totalCents: 4600,
	applicationFeeCents: 163,
	customerEmail: 'ada@example.com',
	customerName: 'Ada',
	shippingAddress: { name: 'Ada', line1: '1 Main St', line2: null, city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US', phone: null, email: 'ada@example.com' },
	note: null,
	needsAttention: null,
	items: [{ lineNo: 1, kind: 'own', productId: 'trail-mug', variantId: 'trail-mug-blue', name: 'Trail Mug, Blue', quantity: 2, unitPriceCents: 2000, catalogVariantId: null, lockedCatalogPriceCents: null }],
	createdAt: new Date(1_800_000_000_000),
};

/** The store's last order number is 4. */
const LAST_NUMBER = (sql: string): unknown[][] => (sql.toLowerCase().includes('max(') ? [[4]] : []);

describe('StoreOrderService.recordOrder', () => {
	it("writes the order after the store's last number, its items and the completed checkout in one batch", async () => {
		const { d1, batches } = recordingD1(LAST_NUMBER);
		const orders = new StoreOrderService({ DB: d1 } as unknown as Env);

		expect(await orders.recordOrder(ORDER)).toBe('recorded');
		expect(batches).toHaveLength(1);
		expect(batches[0].map((entry) => entry.sql.split(' ').slice(0, 3).join(' ').toLowerCase())).toEqual([
			'insert into "store_orders"',
			'insert into "store_order_items"',
			'update "store_checkouts" set',
		]);
		expect(batches[0][0].params).toContain(5);
		expect(batches[0][0].params).toContain(JSON.stringify(ORDER.shippingAddress));
	});

	it("writes each item in its own statement, so a 50-line cart stays under D1's 100 parameters per statement", async () => {
		const { d1, batches } = recordingD1(LAST_NUMBER);
		const orders = new StoreOrderService({ DB: d1 } as unknown as Env);
		const items = Array.from({ length: 50 }, (_, index) => ({ ...ORDER.items[0], lineNo: index + 1 }));

		expect(await orders.recordOrder({ ...ORDER, items })).toBe('recorded');
		expect(batches[0]).toHaveLength(52);
		expect(Math.max(...batches[0].map((entry) => entry.params.length))).toBeLessThanOrEqual(100);
	});

	it('answers already-recorded when the checkout already has an order', async () => {
		const { d1 } = recordingD1(LAST_NUMBER);
		const duplicate = { ...d1, batch: async () => Promise.reject(new Error('D1_ERROR: UNIQUE constraint failed: store_orders.checkout_id: SQLITE_CONSTRAINT')) };
		const orders = new StoreOrderService({ DB: duplicate } as unknown as Env);

		expect(await orders.recordOrder(ORDER)).toBe('already-recorded');
	});

	it('takes the next number when another order took it first', async () => {
		const { d1 } = recordingD1(LAST_NUMBER);
		let attempts = 0;
		const racing = {
			...d1,
			batch: async (statements: object[]) => {
				attempts += 1;
				if (attempts === 1) throw new Error('D1_ERROR: UNIQUE constraint failed: store_orders.app_id, store_orders.mode, store_orders.order_number: SQLITE_CONSTRAINT');
				return d1.batch(statements);
			},
		};
		const orders = new StoreOrderService({ DB: racing } as unknown as Env);

		expect(await orders.recordOrder(ORDER)).toBe('recorded');
		expect(attempts).toBe(2);
	});
});

describe('StoreOrderService.applyRefunds', () => {
	it('counts only refunds Stripe made, never a line claimed but not yet refunded', async () => {
		const { d1, statements } = recordingD1([]);
		await new StoreOrderService({ DB: d1 } as unknown as Env).applyRefunds('ord_1', new Date(0));
		const update = statements.find((entry) => entry.sql.toLowerCase().startsWith('update "store_orders"'));
		expect(update?.sql.toLowerCase()).toContain('"stripe_refund_id" is not null');
	});
});

describe('StoreOrderService.sellerRecord', () => {
	it("reads the seller's first sale, completed orders and 90-day disputes in one mode", async () => {
		const rows = (sql: string): unknown[][] => {
			const lower = sql.toLowerCase();
			if (lower.includes('min(')) return [[1_790_000_000]];
			if (lower.includes('store_disputes')) return [[3, 1]];
			if (lower.includes('not exists')) return [[12]];
			return [[150]];
		};
		const { d1, statements } = recordingD1(rows);
		const record = await new StoreOrderService({ DB: d1 } as unknown as Env).sellerRecord('u1', 'live', 1_800_000_000_000);
		expect(record).toEqual({ firstSaleAt: new Date(1_790_000_000_000), completedOrders: 12, ordersLast90Days: 150, disputesLast90Days: 3, lostDisputesLast90Days: 1 });
		// An inquiry takes no money and isn't a chargeback, so it doesn't count toward the dispute rate.
		const disputes = statements.find((entry) => entry.sql.toLowerCase().includes('store_disputes'));
		expect(disputes?.sql.toLowerCase()).toContain("not like 'warning_%'");
		// A loss counts from the day it was lost: chargebacks often take 60 to 75 days to decide.
		expect(disputes?.sql.toLowerCase()).toContain('"store_disputes"."closed_at" >=');
	});
});
