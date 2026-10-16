import { describe, expect, it } from 'vitest';
import { StoreRefundService } from './StoreRefundService';
import { recordingD1 } from '../test-support/recording-d1';

describe('StoreRefundService', () => {
	it('records a refund once per Stripe refund', async () => {
		const { d1, statements } = recordingD1();
		await new StoreRefundService({ DB: d1 } as unknown as Env).record({ refundId: 're_1', orderId: 'ord_1', lineNo: 2, amountCents: 2500, requestId: 'rq_1', initiatedBy: 'seller', now: new Date(0) });
		const insert = statements.find((entry) => entry.sql.toLowerCase().startsWith('insert into "store_refunds"'));
		expect(insert?.params).toEqual(expect.arrayContaining(['re_1', 'ord_1', 2, 2500, 'rq_1', 'seller']));
		expect(insert?.sql.toLowerCase()).toContain('on conflict');
	});

	it('lists the lines already refunded', async () => {
		const { d1 } = recordingD1([[1], [2]]);
		expect([...(await new StoreRefundService({ DB: d1 } as unknown as Env).refundedLines('ord_1'))]).toEqual([1, 2]);
	});
});
