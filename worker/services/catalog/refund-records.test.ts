import { describe, expect, it } from 'vitest';
import { recordingD1 } from '../../database/test-support/recording-d1';
import { catalogRefundRecords } from './refund-records';

/** Catalog item ci_cap was sold by u1 on line 1 of store order ord_1. */
const rows = (sql: string): unknown[][] => {
	const lower = sql.toLowerCase();
	if (lower.includes('from "catalog_order_items"')) return [['cs_1', 'cv_cap', 'u1']];
	if (lower.includes('from "store_order_items"')) return [['ord_1', 1]];
	return [];
};

const insertInto = (statements: Array<{ sql: string; params: unknown[] }>, table: string) => statements.find((entry) => entry.sql.toLowerCase().startsWith(`insert into "${table}"`));

describe('catalogRefundRecords', () => {
	it("charges the seller the share their transfer couldn't cover, once per item", async () => {
		const { d1, statements } = recordingD1(rows);
		await catalogRefundRecords({ DB: d1 } as unknown as Env, null).addShortfall({ catalogItemId: 'ci_cap', amountCents: 1800 });
		expect(insertInto(statements, 'seller_charges')?.params).toEqual(expect.arrayContaining(['u1', 'refund-shortfall', 'catalog-item-ci_cap', 1800]));
	});

	it('records a refund Estori started as Estori\'s', async () => {
		const { d1, statements } = recordingD1(rows);
		await catalogRefundRecords({ DB: d1 } as unknown as Env, null).recordRefund({ catalogItemId: 'ci_cap', refundId: 're_1', amountCents: 2800, reason: 'supplier-rejected' });
		expect(insertInto(statements, 'store_refunds')?.params).toEqual(expect.arrayContaining(['sr_ord_1_1', 'estori', 'catalog-re_1', 're_1']));
	});

	it("records a seller's refund under the seller's request", async () => {
		const { d1, statements } = recordingD1(rows);
		await catalogRefundRecords({ DB: d1 } as unknown as Env, 'rq_1').recordRefund({ catalogItemId: 'ci_cap', refundId: 're_1', amountCents: 2800, reason: 'seller-refund' });
		expect(insertInto(statements, 'store_refunds')?.params).toEqual(expect.arrayContaining(['sr_ord_1_1', 'seller', 'rq_1', 're_1']));
	});
});
