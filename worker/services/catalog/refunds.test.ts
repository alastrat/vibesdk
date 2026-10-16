import { describe, expect, it } from 'vitest';
import { itemRefundSplit } from './refunds';

describe('itemRefundSplit', () => {
	it("returns the catalog price from Estori when the supplier rejected the item, and the rest from the seller's share", () => {
		expect(itemRefundSplit({ reason: 'supplier-rejected', retailCents: 5000, catalogCents: 2400, supplierRefunded: false })).toEqual({
			shopperCents: 5000,
			sellerCents: 2600,
			estoriCents: 2400,
		});
	});

	it('returns the catalog price from Estori on a seller refund only when the supplier refunded Estori', () => {
		expect(itemRefundSplit({ reason: 'seller-refund', retailCents: 5000, catalogCents: 2400, supplierRefunded: true })).toEqual({
			shopperCents: 5000,
			sellerCents: 2600,
			estoriCents: 2400,
		});
		expect(itemRefundSplit({ reason: 'seller-refund', retailCents: 5000, catalogCents: 2400, supplierRefunded: false })).toEqual({
			shopperCents: 5000,
			sellerCents: 5000,
			estoriCents: 0,
		});
	});

	it('always splits the refund exactly between seller and Estori', () => {
		for (const supplierRefunded of [true, false]) {
			for (const reason of ['supplier-rejected', 'seller-refund'] as const) {
				const split = itemRefundSplit({ reason, retailCents: 3333, catalogCents: 1111, supplierRefunded });
				expect(split.sellerCents + split.estoriCents).toBe(split.shopperCents);
			}
		}
	});

	it('refuses amounts the cart check never allows', () => {
		expect(() => itemRefundSplit({ reason: 'seller-refund', retailCents: 1000, catalogCents: 1200, supplierRefunded: true })).toThrow(RangeError);
		expect(() => itemRefundSplit({ reason: 'seller-refund', retailCents: -1, catalogCents: 0, supplierRefunded: false })).toThrow(RangeError);
	});
});
