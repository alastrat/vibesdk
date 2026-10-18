import { describe, expect, it } from 'vitest';
import { parseSellerShipmentRequest } from './shipment-request';

describe('a shipment request', () => {
	it('names a known carrier by its display name, keeps a typed one for Other, and trims the tracking number', () => {
		expect(parseSellerShipmentRequest({ shipped: true, carrier: 'usps', trackingNumber: ' 9400 1000-22 ' })).toEqual({ shipped: true, carrier: 'USPS', trackingNumber: '9400 1000-22' });
		expect(parseSellerShipmentRequest({ shipped: true, carrier: 'other', carrierName: ' Canada Post ' })).toEqual({ shipped: true, carrier: 'Canada Post', trackingNumber: null });
		expect(parseSellerShipmentRequest({ shipped: true, carrier: null, trackingNumber: '' })).toEqual({ shipped: true, carrier: null, trackingNumber: null });
		expect(parseSellerShipmentRequest({ shipped: false })).toEqual({ shipped: false });
	});

	it('refuses unknown carriers, Other without a name, long or odd tracking numbers and control characters', () => {
		for (const body of [
			null,
			{},
			{ shipped: 'yes' },
			{ shipped: true, carrier: 'pigeon' },
			{ shipped: true, carrier: 'other' },
			{ shipped: true, carrier: 'other', carrierName: 'x'.repeat(41) },
			{ shipped: true, carrier: 'other', carrierName: 'Post\u0007' },
			{ shipped: true, carrier: null, trackingNumber: 'x'.repeat(65) },
			{ shipped: true, carrier: null, trackingNumber: '<script>' },
		]) {
			expect(parseSellerShipmentRequest(body), JSON.stringify(body)).toBeNull();
		}
	});
});
