import { describe, expect, it } from 'vitest';
import es from '../i18n/catalogs/es.json';
import ptBR from '../i18n/catalogs/pt-BR.json';
import { translate } from '../i18n/translate';
import { isSellerOrderModeFilter, isSellerOrderView, sellerOrderPath, STORE_CHECKOUT_MESSAGES, type StoreCheckoutRefusal } from './store-payments';

describe('seller order paths and filters', () => {
	it('links an order under the Orders page', () => {
		expect(sellerOrderPath('ord_ab12')).toBe('/orders/ord_ab12');
	});

	it('knows its views and modes', () => {
		expect(isSellerOrderView('to-ship')).toBe(true);
		expect(isSellerOrderView('late')).toBe(false);
		expect(isSellerOrderModeFilter('all')).toBe(true);
		expect(isSellerOrderModeFilter('test')).toBe(false);
	});
});

describe('checkout refusal messages', () => {
	const REASONS = Object.keys(STORE_CHECKOUT_MESSAGES) as StoreCheckoutRefusal[];

	it('read as they always did in English, which the checkout page and stores show as they are', () => {
		expect(STORE_CHECKOUT_MESSAGES).toEqual({
			payments_unavailable: "This store can't take payments right now.",
			demo_only: 'This is a demo. Checkout works on the live store.',
			invalid_request: "Your cart couldn't be read. Refresh the page and try again.",
			unknown_item: 'An item in your cart is no longer sold here.',
			item_unavailable: 'An item in your cart is sold out.',
			ships_to_unsupported: "This store doesn't ship to that country.",
			below_minimum_price: "An item in your cart can't be sold at its current price.",
			cart_limits: 'Your cart is more than one order can hold.',
			order_over_limit: "This store can't take an order this large yet.",
			store_paused: "This store isn't taking new orders right now. Try again later.",
			too_many_checkouts: 'Too many checkouts were started from here. Wait a few minutes and try again.',
			stripe_failed: "Checkout couldn't start. Try again in a moment.",
		});
		for (const reason of REASONS) expect(translate(null, STORE_CHECKOUT_MESSAGES[reason])).toBe(STORE_CHECKOUT_MESSAGES[reason]);
	});

	it.each([
		['es', es],
		['pt-BR', ptBR],
	] as const)('has its own wording of every refusal in %s', (_locale, catalog) => {
		for (const reason of REASONS) {
			const message = translate(catalog, STORE_CHECKOUT_MESSAGES[reason]);
			expect(message.trim(), reason).not.toBe('');
			expect(message, reason).not.toBe(STORE_CHECKOUT_MESSAGES[reason]);
		}
	});
});
