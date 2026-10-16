import { describe, expect, it } from 'vitest';
import { StoreRefundService } from './StoreRefundService';
import { recordingD1 } from '../test-support/recording-d1';

describe('StoreRefundService', () => {
	it('claims a line once, keyed by order and line, and returns whichever claim holds it', async () => {
		const { d1, statements } = recordingD1([[2, 'rq_1', 2500, 2500, null, null]]);
		const row = await new StoreRefundService({ DB: d1 } as unknown as Env).claimRefund({ orderId: 'ord_1', lineNo: 2, requestId: 'rq_2', initiatedBy: 'seller', amountCents: 2500, reversalCents: 2500, now: new Date(0) });
		const insert = statements.find((entry) => entry.sql.toLowerCase().startsWith('insert into "store_refunds"'));
		expect(insert?.params).toEqual(expect.arrayContaining(['sr_ord_1_2', 'ord_1', 2, 'rq_2', 'seller']));
		expect(insert?.sql.toLowerCase()).toContain('on conflict');
		expect(row).toEqual({ lineNo: 2, requestId: 'rq_1', amountCents: 2500, reversalCents: 2500, stripeRefundId: null, reversalId: null });
	});

	it("records a catalog refund on its store line with whoever started it", async () => {
		const rows = (sql: string): unknown[][] => (sql.toLowerCase().includes('from "store_order_items"') ? [['ord_1', 1]] : []);
		const { d1, statements } = recordingD1(rows);
		await new StoreRefundService({ DB: d1 } as unknown as Env).recordForCatalogItem({ checkoutSessionId: 'cs_1', catalogVariantId: 'cv_feeder', refundId: 're_1', amountCents: 4099, initiatedBy: 'seller', requestId: 'rq_1', now: new Date(0) });
		const insert = statements.find((entry) => entry.sql.toLowerCase().startsWith('insert into "store_refunds"'));
		expect(insert?.params).toEqual(expect.arrayContaining(['sr_ord_1_1', 'ord_1', 1, 4099, 'rq_1', 'seller', 're_1']));
	});
});
