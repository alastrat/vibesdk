import { describe, expect, it } from 'vitest';
import { orderSummary } from './order-summary';
import type { StoreOrderView } from '../../../services/store-payments/store';

const ORDER: StoreOrderView = {
	id: 'ord_1', orderNumber: 7, mode: 'live', appId: 'app_1', paymentStatus: 'paid', fulfillmentStatus: 'unfulfilled',
	subtotalCents: 2500, shippingCents: 0, totalCents: 2500, applicationFeeCents: 103, currency: 'usd',
	customerEmail: 'shopper@example.test', customerName: 'Ana', shippingAddress: null, note: 'Happy birthday, Mom!', needsAttention: null,
	stripeCheckoutSessionId: 'cs_1', createdAt: new Date(0),
	sellerUserId: 'u1', sellerStripeAccountId: 'acct_1', stripePaymentIntentId: 'pi_1', refundedCents: 0,
	items: [{ lineNo: 1, kind: 'own', productId: 'gift', variantId: 'gift-25', name: 'Gift Card', quantity: 1, unitPriceCents: 2500, catalogVariantId: null, lockedCatalogPriceCents: null }],
};

describe("a store order for its owner", () => {
	it("carries the shopper's order note, so the seller can act on it", () => {
		expect(orderSummary(ORDER, [])).toMatchObject({ orderNumber: 7, note: 'Happy birthday, Mom!' });
		expect(orderSummary({ ...ORDER, note: null }, []).note).toBeNull();
	});
});
