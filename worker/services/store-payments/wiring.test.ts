import { describe, expect, it } from 'vitest';
import { recordingD1 } from '../../database/test-support/recording-d1';
import { returnPageRecordDeps, storeRefundDeps } from './wiring';
import type { StripeClient } from '../payments/stripe-client';
import type { StoreOrderView } from './store';

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
});
