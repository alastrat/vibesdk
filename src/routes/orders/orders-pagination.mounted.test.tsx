import type { ReactTestInstance } from 'react-test-renderer';
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SellerOrderRow } from '@/api-types';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { mountElement, silenceTestRendererDeprecation, textOf, unmountAll } from '@/test-support/mounted';
import { StoreOrdersPanel } from './orders';
vi.mock('@cloudflare/kumo', async (original) => {
 const actual = await original<typeof import('@cloudflare/kumo')>();
 return { ...actual, Select: ({ value, items, onValueChange, 'aria-label': label }: { value: string; items: Record<string, string>; onValueChange: (value: string) => void; 'aria-label': string }) => <select aria-label={label} value={value} onChange={(event) => onValueChange(event.target.value)}>{Object.entries(items).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select> };
});
const first: SellerOrderRow = { id: 'first', appId: 'tea', storeTitle: 'Tea shop', mode: 'test', orderNumber: 18, createdAt: '2025-01-01T12:00:00Z', customerName: 'First buyer', customerEmail: 'first@example.com', totalCents: 1200, paymentStatus: 'paid', fulfillmentStatus: 'unfulfilled', units: 1, ownUnits: 1, catalogUnits: 0 };
function buttonText(node: ReactTestInstance): string { return node.children.map((child) => typeof child === 'string' ? child : buttonText(child)).join(''); }
beforeAll(silenceTestRendererDeprecation);
afterEach(async () => { await unmountAll(); vi.restoreAllMocks(); });
describe('store order cursor pagination', () => {
 it('loads older history without losing store or live/test filters', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.account.sellerOrders.list('all', 'all', 'tea'), { pages: [{ orders: [first], nextCursor: 'older-page', stores: [{ appId: 'tea', title: 'Tea shop' }], hasTestOrders: true }], pageParams: [null] });
  const next = vi.spyOn(apiClient, 'getSellerOrders').mockResolvedValue({ success: true, data: { orders: [{ ...first, id: 'older', orderNumber: 17, createdAt: '2024-01-01T12:00:00Z', customerName: 'Older buyer' }], nextCursor: null, stores: [{ appId: 'tea', title: 'Tea shop' }], hasTestOrders: true } });
  const renderer = await mountElement(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/stores/tea?section=payments&mode=all&view=all']}><StoreOrdersPanel appId="tea" /></MemoryRouter></QueryClientProvider>);
  await act(async () => renderer.root.findAllByType('button').find((button) => buttonText(button).includes('Load more'))!.props.onClick());
  for (let i = 0; i < 3; i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(next).toHaveBeenCalledWith({ view: 'all', mode: 'all', store: 'tea', cursor: 'older-page' });
  expect(textOf(renderer)).toContain('First buyer');
  expect(textOf(renderer)).toContain('Older buyer');
  expect(renderer.root.findAllByType('a').some((link) => link.props.href.startsWith('/stores/tea/orders/older?'))).toBe(true);
  expect(renderer.root.findAllByType('button').some((button) => buttonText(button) === 'Load more')).toBe(false);
 });
});
