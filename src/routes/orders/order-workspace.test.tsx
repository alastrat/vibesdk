import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { SellerOrderDetail } from '@/api-types';
import { queryKeys } from '@/lib/query-keys';
import SellerOrderPage from './order';

vi.mock('@/hooks/use-billing', () => ({ useBilling: () => ({ data: { enabled: false } }) }));
const order: SellerOrderDetail = {
	id: 'order-1', appId: 'tea', storeTitle: 'Tea shop', orderNumber: 42, mode: 'live',
	paymentStatus: 'paid', fulfillmentStatus: 'unfulfilled', subtotalCents: 1200, shippingCents: 0,
	totalCents: 1200, applicationFeeCents: 60, customerName: 'Private buyer', customerEmail: 'buyer@example.com',
	customerPhone: null, shipTo: null, note: null, needsAttention: null, createdAt: '2026-10-21T12:00:00Z',
	items: [], catalogItems: [], refundedCents: 0, carrier: null, trackingNumber: null, shippedAt: null, dispute: null,
};
function render(path: string, route: string) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	client.setQueryData(queryKeys.account.sellerOrders.detail(order.id), order);
	return renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={<SellerOrderPage />} /></Routes></MemoryRouter></QueryClientProvider>);
}
describe('order detail inside a store workspace', () => {
	it('shows the matching store order and returns to that store payments', () => {
		const html = render('/stores/tea/orders/order-1', '/stores/:storeId/orders/:id');
		expect(html).toContain('Order #42 at Tea shop');
		expect(html).toContain('buyer@example.com');
		expect(html).toContain('href="/stores/tea?section=payments"');
	});
	it('does not display a cached order from another store under the current store URL', () => {
		const html = render('/stores/candles/orders/order-1', '/stores/:storeId/orders/:id');
		expect(html).toContain('href="/stores/candles?section=payments"');
		expect(html).toContain('Couldn&#x27;t load the order');
		expect(html).not.toContain('Private buyer');
		expect(html).not.toContain('buyer@example.com');
		expect(html).not.toContain('Order #42');
	});
	it('preserves direct global order links for receipts and bookmarks', () => {
		const html = render('/orders/order-1', '/orders/:id');
		expect(html).toContain('Order #42 at Tea shop');
		expect(html).toContain('href="/orders"');
	});
});
