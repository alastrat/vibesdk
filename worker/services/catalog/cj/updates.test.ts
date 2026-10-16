import { describe, expect, it } from 'vitest';
import { carrierText, cjOrderToUpdates } from './updates';
import type { CjOrderDetail } from './types';

const ORDER: CjOrderDetail = { orderId: 'cj_1', orderNum: 'n', orderStatus: 'UNSHIPPED', trackNumber: null, trackingProvider: null, logisticName: 'USPS US to US', orderAmount: 16.9, productList: [{ vid: 'v1', quantity: 1 }] };

describe('cjOrderToUpdates', () => {
	it('reports nothing for an order still being prepared', () => {
		expect(cjOrderToUpdates(ORDER)).toEqual([]);
	});

	it('reports tracking as soon as there is a number, then delivery', () => {
		expect(cjOrderToUpdates({ ...ORDER, orderStatus: 'SHIPPED', trackNumber: '9400111899223197428490', trackingProvider: 'USPS' })).toEqual([
			{ kind: 'shipped', supplierOrderId: 'cj_1', trackingNumber: '9400111899223197428490', carrier: 'USPS' },
		]);
		expect(cjOrderToUpdates({ ...ORDER, orderStatus: 'DELIVERED', trackNumber: 'SBX1', trackingProvider: 'CJPacket', logisticName: 'CJPacket Ordinary' })).toEqual([
			{ kind: 'shipped', supplierOrderId: 'cj_1', trackingNumber: 'SBX1', carrier: 'Standard shipping' },
			{ kind: 'delivered', supplierOrderId: 'cj_1' },
		]);
	});

	it('reports a cancellation of the whole supplier order', () => {
		expect(cjOrderToUpdates({ ...ORDER, orderStatus: 'CANCELLED' })).toEqual([{ kind: 'cancelled', supplierOrderId: 'cj_1', supplierVariantIds: [], reason: 'Cancelled by the supplier' }]);
	});
});

describe('carrierText', () => {
	it("names last-mile carriers and never the supplier's channel", () => {
		expect(carrierText('UPS Ground', null)).toBe('UPS');
		expect(carrierText(null, 'USPS US to US')).toBe('USPS');
		expect(carrierText('Fedex', null)).toBe('FedEx');
		expect(carrierText('CJPacket Ordinary', 'CJPacket')).toBe('Standard shipping');
		expect(carrierText(null, null)).toBe('Standard shipping');
	});
});
