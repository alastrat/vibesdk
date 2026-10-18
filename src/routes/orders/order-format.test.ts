import { describe, expect, it } from 'vitest';
import { customerLabel, itemsSummary, moneySplit, shipToLines, shippingStatus, storeLabel } from './order-format';

const ROW = { units: 3, ownUnits: 2, catalogUnits: 1, fulfillmentStatus: 'unfulfilled' as const, paymentStatus: 'paid' as const };

describe('orders on the seller pages', () => {
	it('says what the seller ships and what Estori ships', () => {
		expect(shippingStatus(ROW)).toBe('To ship · Estori ships 1');
		expect(shippingStatus({ ...ROW, fulfillmentStatus: 'fulfilled' })).toBe('Shipped · Estori ships 1');
		expect(shippingStatus({ ...ROW, ownUnits: 0 })).toBe('Estori ships 1');
		expect(shippingStatus({ ...ROW, ownUnits: 0, catalogUnits: 0 })).toBe('Nothing to ship');
	});

	it('counts items and those still to ship', () => {
		expect(itemsSummary(ROW)).toBe('3 items, 2 to ship');
		expect(itemsSummary({ ...ROW, units: 1, ownUnits: 0, catalogUnits: 1 })).toBe('1 item');
		expect(itemsSummary({ ...ROW, fulfillmentStatus: 'fulfilled' })).toBe('3 items');
	});

	it("splits the money: paid, Estori's fee, refunded and the seller's share", () => {
		expect(moneySplit({ totalCents: 4599, applicationFeeCents: 460, refundedCents: 1000 })).toEqual({ paidCents: 4599, feeCents: 460, refundedCents: 1000, shareCents: 3139 });
	});

	it('names a deleted store and an unknown shopper, and lays out an address or its absence', () => {
		expect(storeLabel(null)).toBe('Deleted store');
		expect(storeLabel('Northwind Tea')).toBe('Northwind Tea');
		expect(customerLabel(null, 'ana@example.test')).toBe('ana@example.test');
		expect(customerLabel(null, null)).toBe('Unknown shopper');
		expect(shipToLines(null)).toEqual(['No shipping address on this order']);
		expect(shipToLines({ name: 'Ana Ruiz', line1: '12 Elm St', line2: 'Apt 2', city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US' })).toEqual(['Ana Ruiz', '12 Elm St', 'Apt 2', 'Austin, TX 78701', 'US']);
	});
});
