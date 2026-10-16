import { describe, expect, it } from 'vitest';
import { applySupplierUpdate } from './updates';
import type { CatalogOrderItemRow } from './store';

const ITEM: CatalogOrderItemRow = {
	id: 'ci_mug',
	catalogVariantId: 'cv_mug',
	supplier: 'cjdropshipping',
	supplierVariantId: 'cj_mug',
	quantity: 2,
	unitPriceCents: 2500,
	catalogPriceCents: 1200,
	status: 'placed',
	supplierOrderId: 'cj_9',
	trackingNumber: null,
	carrier: null,
	supplierRefunded: false,
};

describe('applySupplierUpdate', () => {
	it('marks the supplier order shipped, with tracking', () => {
		expect(applySupplierUpdate([ITEM], { kind: 'shipped', supplierOrderId: 'cj_9', trackingNumber: '1Z999', carrier: 'UPS' })).toEqual([
			{ itemId: 'ci_mug', status: 'shipped', trackingNumber: '1Z999', carrier: 'UPS' },
		]);
	});

	it('marks it delivered, from placed or shipped', () => {
		expect(applySupplierUpdate([{ ...ITEM, status: 'shipped' }], { kind: 'delivered', supplierOrderId: 'cj_9' })).toEqual([{ itemId: 'ci_mug', status: 'delivered' }]);
		expect(applySupplierUpdate([ITEM], { kind: 'delivered', supplierOrderId: 'cj_9' })).toEqual([{ itemId: 'ci_mug', status: 'delivered' }]);
	});

	it('never moves an item backwards, and ignores repeated reports', () => {
		expect(applySupplierUpdate([{ ...ITEM, status: 'delivered' }], { kind: 'shipped', supplierOrderId: 'cj_9', trackingNumber: '1Z999', carrier: 'UPS' })).toEqual([]);
		expect(applySupplierUpdate([{ ...ITEM, status: 'refunded' }], { kind: 'delivered', supplierOrderId: 'cj_9' })).toEqual([]);
	});

	it('records a supplier refund once, for the variants it names', () => {
		const cap = { ...ITEM, id: 'ci_cap', supplierVariantId: 'cj_cap' };
		expect(applySupplierUpdate([ITEM, cap], { kind: 'refunded', supplierOrderId: 'cj_9', supplierVariantIds: ['cj_cap'] })).toEqual([
			{ itemId: 'ci_cap', supplierRefunded: true },
		]);
		expect(applySupplierUpdate([{ ...cap, supplierRefunded: true }], { kind: 'refunded', supplierOrderId: 'cj_9', supplierVariantIds: ['cj_cap'] })).toEqual([]);
	});

	it("replaces a shipped item's tracking when a later report carries a different number", () => {
		const shipped = { ...ITEM, status: 'shipped' as const, trackingNumber: 'CJPKL7160102171YQ', carrier: 'CJPacket' };
		expect(applySupplierUpdate([shipped], { kind: 'shipped', supplierOrderId: 'cj_9', trackingNumber: '9400111899223197428490', carrier: 'USPS' })).toEqual([
			{ itemId: 'ci_mug', trackingNumber: '9400111899223197428490', carrier: 'USPS' },
		]);
		expect(applySupplierUpdate([shipped], { kind: 'shipped', supplierOrderId: 'cj_9', trackingNumber: 'CJPKL7160102171YQ', carrier: 'CJPacket' })).toEqual([]);
	});

	it('rejects the cancelled variants that were placed or shipped, so they can be refunded', () => {
		const cap = { ...ITEM, id: 'ci_cap', supplierVariantId: 'cj_cap', status: 'shipped' as const };
		const delivered = { ...ITEM, id: 'ci_pin', supplierVariantId: 'cj_pin', status: 'delivered' as const };
		expect(applySupplierUpdate([ITEM, cap, delivered], { kind: 'cancelled', supplierOrderId: 'cj_9', supplierVariantIds: ['cj_cap'], reason: 'Out of stock' })).toEqual([
			{ itemId: 'ci_cap', status: 'rejected' },
		]);
		// No variant named: the whole supplier order was cancelled, except what already arrived.
		expect(applySupplierUpdate([ITEM, cap, delivered], { kind: 'cancelled', supplierOrderId: 'cj_9', supplierVariantIds: [], reason: 'Cancelled' })).toEqual([
			{ itemId: 'ci_mug', status: 'rejected' },
			{ itemId: 'ci_cap', status: 'rejected' },
		]);
	});

	it("leaves other supplier orders' items alone", () => {
		expect(applySupplierUpdate([ITEM], { kind: 'delivered', supplierOrderId: 'cj_other' })).toEqual([]);
	});
});
