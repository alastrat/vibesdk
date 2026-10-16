import { describe, expect, it } from 'vitest';
import { parseStoreRefundRequest, shortBalanceMessage } from './refund-request';

describe('parseStoreRefundRequest', () => {
	it('accepts line numbers and a request id', () => {
		expect(parseStoreRefundRequest({ lineNos: [1, 2], requestId: 'rq_12345678' })).toEqual({ lineNos: [1, 2], requestId: 'rq_12345678' });
	});

	it('refuses amounts, bad lines and bad ids', () => {
		for (const body of [
			{ lineNos: [1], requestId: 'rq_12345678', amountCents: 100 },
			{ lineNos: [], requestId: 'rq_12345678' },
			{ lineNos: [0], requestId: 'rq_12345678' },
			{ lineNos: [1.5], requestId: 'rq_12345678' },
			{ lineNos: [1], requestId: 'short' },
			{ lineNos: [1], requestId: 'has spaces in it' },
			null,
		]) {
			expect(parseStoreRefundRequest(body)).toBeNull();
		}
	});

	it('tells the seller how short their balance is', () => {
		expect(shortBalanceMessage(1)).toBe('Your Stripe balance is $0.01 short for this refund. It can go through once more sales come in.');
	});
});
