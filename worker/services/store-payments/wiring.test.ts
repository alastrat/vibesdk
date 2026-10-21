import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordingD1 } from '../../database/test-support/recording-d1';
import { CATALOG_REFRESH_CRON, CATALOG_SWEEP_CRON } from '../catalog/scheduler';
import type { StripeClient } from '../payments/stripe-client';
import type { NewStoreOrder, StoreOrderView } from './store';

const captured = vi.hoisted((): Array<[string, string, Record<string, unknown>]> => []);
vi.mock('../posthog/analytics', () => ({
	serverAnalytics: () => ({ capture: (name: string, userId: string, properties: Record<string, unknown>) => void captured.push([name, userId, properties]) }),
}));

const { recordStoreOrderDeps, returnPageRecordDeps, runStorePaymentsSchedule, storeRefundDeps } = await import('./wiring');

afterEach(() => {
	captured.length = 0;
	vi.restoreAllMocks();
});

const ORDER = { id: 'ord_1', sellerUserId: 'u1', sellerStripeAccountId: 'acct_1', stripeCheckoutSessionId: 'cs_1', items: [] } as unknown as StoreOrderView;

describe('storeRefundDeps', () => {
	it("charges the seller a line's uncovered share once, keyed by the order and line", async () => {
		const { d1, statements } = recordingD1();
		const deps = storeRefundDeps({ DB: d1 } as unknown as Env, {} as StripeClient, { order: ORDER, sellerAccountId: 'acct_1', requestId: 'rq_1' });
		await deps.addShortfall({ orderId: 'ord_1', lineNo: 2, amountCents: 1500 });
		const insert = statements.find((entry) => entry.sql.toLowerCase().startsWith('insert into "seller_charges"'));
		expect(insert?.params).toEqual(expect.arrayContaining(['u1', 'refund-shortfall', 'refund-ord_1-2', 1500]));
	});
});

describe('storeRefundDeps catalog lines', () => {
	it('fails rather than report catalog lines refunded when their catalog order is missing', async () => {
		const { d1 } = recordingD1();
		const order = { ...ORDER, items: [{ lineNo: 1, kind: 'catalog', catalogVariantId: 'cv_1' }] } as unknown as StoreOrderView;
		const deps = storeRefundDeps({ DB: d1 } as unknown as Env, {} as StripeClient, { order, sellerAccountId: 'acct_1', requestId: 'rq_1' });
		await expect(deps.catalogSellerCents([1])).rejects.toThrow('has catalog lines but no catalog order');
		await expect(deps.refundCatalogLines([1])).rejects.toThrow('has catalog lines but no catalog order');
	});
});

describe('returnPageRecordDeps', () => {
	it("never fails the shopper's return when settling fails, since the webhook settles the sale", async () => {
		const failing = {
			...recordingD1().d1,
			prepare: () => {
				throw new Error('D1 is unavailable');
			},
		};
		const deps = returnPageRecordDeps({ DB: failing, STRIPE_SECRET_KEY: 'sk_test_return' } as unknown as Env);
		await expect(deps.settleSale('ord_1')).resolves.toBeUndefined();
	});

	it("leaves the shopper's confirmation to the webhook, so the return page doesn't wait on Email Service", async () => {
		const { d1, statements } = recordingD1();
		const deps = returnPageRecordDeps({ DB: d1, STRIPE_SECRET_KEY: 'sk_test_return' } as unknown as Env);
		await deps.queueShopperEmail({ orderId: 'ord_1', kind: 'order_confirmation', eventKey: 'order', payload: {} });
		expect(statements).toEqual([]);
	});
});

describe('runStorePaymentsSchedule', () => {
	it('looks for unsettled store sales on the hourly sweep, and on no other schedule', async () => {
		const { d1, statements } = recordingD1();
		const env = { DB: d1, STRIPE_SECRET_KEY: 'sk_test_sweep' } as unknown as Env;
		await runStorePaymentsSchedule(CATALOG_REFRESH_CRON, env);
		expect(statements).toEqual([]);
		await runStorePaymentsSchedule(CATALOG_SWEEP_CRON, env);
		expect(statements.some((entry) => entry.sql.includes('"store_orders"') && entry.sql.includes('"store_fee_adjustments"'))).toBe(true);
	});
});

describe('recordStoreOrderDeps analytics', () => {
	const NEW_ORDER = { id: 'ord_1', mode: 'live', appId: 'app_1', checkoutId: 'chk_1', sellerUserId: 'u1', totalCents: 4099, applicationFeeCents: 205, items: [] } as unknown as NewStoreOrder;

	it('still records the sale, and warns, when the seller\'s order count cannot be read', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const { d1 } = recordingD1((sql) => {
			if (sql.toLowerCase().includes('count(*)')) throw new Error('D1 is unavailable');
			return [];
		});
		expect(await recordStoreOrderDeps({ DB: d1 } as unknown as Env).recordOrder(NEW_ORDER)).toBe('recorded');
		expect(captured).toEqual([['sale_completed', 'u1', expect.objectContaining({ app_id: 'app_1', first_sale: false })]]);
		const logged = warn.mock.calls.map(([line]) => String(line));
		expect(logged).toHaveLength(1);
		expect(logged[0]).toContain("Could not count the seller's orders");
		expect(logged[0]).toContain('"sellerUserId":"u1"');
		expect(logged[0]).toContain('D1 is unavailable');
	});
});
