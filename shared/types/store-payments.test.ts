import { describe, expect, it } from 'vitest';
import { isSellerOrderModeFilter, isSellerOrderView, sellerOrderPath } from './store-payments';

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
