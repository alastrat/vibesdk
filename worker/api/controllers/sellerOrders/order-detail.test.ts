import { describe, expect, it } from 'vitest';
import { sellerOrderDetail } from './order-detail';
import type { StoreOrderView } from '../../../services/store-payments/store';

const ORDER: StoreOrderView = {
	id: 'ord_1', orderNumber: 7, mode: 'live', appId: 'app_tea', paymentStatus: 'paid', fulfillmentStatus: 'fulfilled',
	subtotalCents: 3000, shippingCents: 0, totalCents: 3000, applicationFeeCents: 300, currency: 'usd',
	customerEmail: 'ana@example.test', customerName: 'Ana Ruiz',
	shippingAddress: { name: 'Ana Ruiz', line1: '12 Elm St', line2: null, city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US', phone: '+15125550100', email: null },
	note: 'Gift', needsAttention: null, stripeCheckoutSessionId: 'cs_1', stripePaymentIntentId: 'pi_1', sellerUserId: 'seller_1', sellerStripeAccountId: 'acct_1', refundedCents: 1000, createdAt: new Date(0),
	items: [
		{ lineNo: 1, kind: 'own', productId: 'tea', variantId: 'tea-50', name: 'Oolong', quantity: 2, unitPriceCents: 1000, catalogVariantId: null, lockedCatalogPriceCents: null },
		{ lineNo: 2, kind: 'catalog', productId: 'feeder', variantId: 'feeder-1', name: 'Feeder', quantity: 1, unitPriceCents: 1000, catalogVariantId: 'cv_1', lockedCatalogPriceCents: 500 },
	],
};

describe('an order for its seller', () => {
	it('identifies digital fulfillment from purchased snapshot line facts', () => {
  const detail = sellerOrderDetail(ORDER, {storeTitle: 'Store', carrier: null, trackingNumber: null, shippedAt: null, refundedLineNos: [], pendingRefundLineNos: [], dispute: null, digitalLineNos: [1]}, []);
  expect(detail.items[0].productType).toBe('digital');
  expect(detail.items[1].productType).toBeUndefined();
 });
	it('adds the store, phone, shipment, refunds, dispute and per-line refunds to the order summary', () => {
		const detail = sellerOrderDetail(ORDER, { storeTitle: 'Northwind Tea', carrier: 'USPS', trackingNumber: '9400', shippedAt: new Date(1000), refundedLineNos: [2], pendingRefundLineNos: [1], dispute: null }, []);
		expect(detail).toMatchObject({ id: 'ord_1', appId: 'app_tea', storeTitle: 'Northwind Tea', customerPhone: '+15125550100', refundedCents: 1000, carrier: 'USPS', trackingNumber: '9400', shippedAt: new Date(1000).toISOString(), dispute: null, note: 'Gift' });
		expect(detail.items).toEqual([
			{ lineNo: 1, name: 'Oolong', kind: 'own', quantity: 2, unitPriceCents: 1000, catalogVariantId: null, refunded: false, refundPending: true },
			{ lineNo: 2, name: 'Feeder', kind: 'catalog', quantity: 1, unitPriceCents: 1000, catalogVariantId: 'cv_1', refunded: true, refundPending: false },
		]);
	});
});
