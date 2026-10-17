import { describe, expect, it } from 'vitest';
import { addReceiptOrder, readReceiptCookie, receiptAllows, receiptCookieHeader, receiptOf, signReceipt, verifyReceipt } from './receipts';
import { STORE_SCRIPT } from './store-script';
import { JWTUtils } from '../../utils/jwtUtils';
import type { StoreOrderView } from './store';

const ENV = { JWT_SECRET: 'receipt-test-secret-0123456789abcdef' };

describe('receipt claims', () => {
	it('keeps the newest 20 orders of one store, newest first, without repeats', () => {
		let claims = addReceiptOrder(null, 'app_1', 'ord_1');
		claims = addReceiptOrder(claims, 'app_1', 'ord_2');
		claims = addReceiptOrder(claims, 'app_1', 'ord_1');
		expect(claims).toEqual({ appId: 'app_1', orderIds: ['ord_1', 'ord_2'] });
		for (let index = 3; index <= 25; index++) claims = addReceiptOrder(claims, 'app_1', `ord_${index}`);
		expect(claims.orderIds).toHaveLength(20);
		expect(claims.orderIds[0]).toBe('ord_25');
		expect(addReceiptOrder(claims, 'app_2', 'ord_x')).toEqual({ appId: 'app_2', orderIds: ['ord_x'] });
	});

	it("shows an order only to a receipt from the same store that lists it", () => {
		const claims = { appId: 'app_1', orderIds: ['ord_1'] };
		expect(receiptAllows(claims, 'app_1', 'ord_1')).toBe(true);
		expect(receiptAllows(claims, 'app_1', 'ord_2')).toBe(false);
		expect(receiptAllows(claims, 'app_2', 'ord_1')).toBe(false);
		expect(receiptAllows(null, 'app_1', 'ord_1')).toBe(false);
	});
});

describe('the receipt cookie', () => {
	it("is signed, http-only and scoped to the store's platform path", async () => {
		const token = await signReceipt(ENV, { appId: 'app_1', orderIds: ['ord_1'] });
		expect(await verifyReceipt(ENV, token)).toEqual({ appId: 'app_1', orderIds: ['ord_1'] });
		expect(await verifyReceipt(ENV, token.replace(/\.[^.]+$/, '.forged'))).toBeNull();
		const preview = await JWTUtils.getInstance(ENV).signPayload({ appId: 'app_1', orderIds: ['ord_1'], purpose: 'space_preview' }, 60);
		expect(await verifyReceipt(ENV, preview)).toBeNull();
		expect(await verifyReceipt(ENV, null)).toBeNull();

		const header = receiptCookieHeader(token, '/space/app_1/preview/main/__estori/', true);
		expect(header).toContain(`__estori_orders=${token}`);
		for (const attribute of ['Path=/space/app_1/preview/main/__estori/', 'HttpOnly', 'SameSite=Lax', 'Secure', `Max-Age=${90 * 24 * 60 * 60}`]) {
			expect(header).toContain(attribute);
		}
		const request = new Request('https://s.test/', { headers: { Cookie: `other=1; __estori_orders=${token}` } });
		expect(readReceiptCookie(request)).toBe(token);
	});
});

describe('receiptOf', () => {
	it('shows the city and country, never the street address or phone', () => {
		const order: StoreOrderView = {
			id: 'ord_1',
			orderNumber: 7,
			mode: 'test',
			appId: 'app_1',
			paymentStatus: 'paid',
			fulfillmentStatus: 'unfulfilled',
			subtotalCents: 4000,
			shippingCents: 600,
			totalCents: 4600,
			applicationFeeCents: 163,
			currency: 'usd',
			customerEmail: 'ada@example.com',
			customerName: 'Ada',
			shippingAddress: { name: 'Ada', line1: '1 Main St', line2: null, city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US', phone: '+15125550100', email: 'ada@example.com' },
			note: null,
			needsAttention: null,
			stripeCheckoutSessionId: 'cs_1',
			createdAt: new Date('2026-10-16T00:00:00Z'),
			items: [{ lineNo: 1, kind: 'own', productId: 'trail-mug', variantId: 'trail-mug-blue', name: 'Trail Mug, Blue', quantity: 2, unitPriceCents: 2000, catalogVariantId: null, lockedCatalogPriceCents: null }],
		};
		const receipt = receiptOf(order);
		expect(receipt).toEqual({
			orderId: 'ord_1',
			orderNumber: 7,
			createdAt: '2026-10-16T00:00:00.000Z',
			mode: 'test',
			paymentStatus: 'paid',
			items: [{ name: 'Trail Mug, Blue', quantity: 2, unitPriceCents: 2000 }],
			subtotalCents: 4000,
			shippingCents: 600,
			totalCents: 4600,
			shipCity: 'Austin',
			shipCountry: 'US',
			customerEmail: 'ada@example.com',
		});
		expect(JSON.stringify(receipt)).not.toContain('Main St');
	});
});

describe('the store script', () => {
	it('finds the platform from its own address and exposes the cart, store, checkout and order', () => {
		expect(STORE_SCRIPT).toContain('document.currentScript');
		for (const call of ["'/store'", "'/pay'", "'/orders/'", 'window.Estori', 'cart: cart']) expect(STORE_SCRIPT).toContain(call);
	});

	it('always resolves, so a store never waits on an unreadable answer', () => {
		expect(STORE_SCRIPT).toContain('.catch(');
	});
});
