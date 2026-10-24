import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '@/lib/query-keys';
import type { SellerOrderRow, SellerOrdersData } from '@/api-types';
import SellerOrdersPage from './orders';

const oldTestOrder: SellerOrderRow = { id: 'older-test', orderNumber: 17, appId: 'tea', storeTitle: 'Tea shop', mode: 'test', createdAt: '2024-01-01T12:00:00Z', customerName: 'Ada Buyer', customerEmail: 'ada@example.com', totalCents: 1200, paymentStatus: 'paid', fulfillmentStatus: 'unfulfilled', units: 1, ownUnits: 1, catalogUnits: 0 };
function render(path: string) {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
 const data: SellerOrdersData = { orders: [oldTestOrder], nextCursor: 'older-page', stores: [{ appId: 'tea', title: 'Tea shop' }], hasTestOrders: true };
 client.setQueryData(queryKeys.account.sellerOrders.list('all', 'all', 'tea'), { pages: [data], pageParams: [null] });
 return renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><SellerOrdersPage /></MemoryRouter></QueryClientProvider>);
}
describe('order browsing across all time', () => {
 it('opens a bookmarked store and test-inclusive history without a reporting date cutoff', () => {
  const html = render('/orders?store=tea&view=all&mode=all');
  expect(html).toContain('Ada Buyer');
  expect(html).toContain('2024');
  expect(html).toContain('Load more');
  expect(html).toContain('store=tea');
 });
 it('searches loaded history while keeping pagination available to search older pages', () => {
  const html = render('/orders?store=tea&view=all&mode=all&search=missing');
  expect(html).not.toContain('Ada Buyer');
  expect(html).toContain('Load more');
  expect(html).toContain('No orders match');
 });
});
