import { describe, expect, it } from 'vitest';
import { catalogOrderActions, itemProgress, stripePaymentUrl } from './catalog-order-format';

describe('catalog orders on the admin pages', () => {
	it("sums up an order's items by status, in the order an item moves through them", () => {
		expect(itemProgress({ shipped: 2, placed: 1 })).toBe('1 placed, 2 shipped');
		expect(itemProgress({ withheld: 1, delivered: 3, pending: 1 })).toBe('1 pending, 3 delivered, 1 held back');
		expect(itemProgress({})).toBe('No items');
	});

	it('offers Sync always, Retry for a stuck order, Release for a risk hold, and sandbox moves only where the sandbox takes the order', () => {
		expect(catalogOrderActions({ status: 'placement-done', sandbox: false })).toEqual(['sync']);
		expect(catalogOrderActions({ status: 'needs-attention', sandbox: false })).toEqual(['sync', 'retry']);
		expect(catalogOrderActions({ status: 'risk-hold', sandbox: true })).toEqual(['sync', 'release', 'sandbox']);
	});

	it("links a payment to Stripe's dashboard in the order's mode", () => {
		expect(stripePaymentUrl('pi_123', 'test')).toBe('https://dashboard.stripe.com/test/payments/pi_123');
		expect(stripePaymentUrl('pi_123', 'live')).toBe('https://dashboard.stripe.com/payments/pi_123');
	});
});
