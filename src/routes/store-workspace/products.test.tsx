import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { StoreWorkspaceProducts } from '@/api-types';
import { queryKeys } from '@/lib/query-keys';
import { StoreProductsPanel } from './products';

vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }));
vi.mock('@/hooks/use-flag', () => ({ useFlag: () => false }));
const collection: StoreWorkspaceProducts = {
	appId: 'tea', source: 'published', status: 'live', manifestStatus: 'ready', publishedAt: '2026-10-20T12:00:00Z',
	publishedCommit: 'published-1', storeUrl: 'https://tea.shops.example', currency: 'usd',
	products: [{ id: 'tea', name: 'Green tea', description: 'Whole leaf', imageUrl: 'https://tea.shops.example/tea.jpg', variants: [
		{ id: 'box', name: 'Box', priceCents: 1400, available: true, kind: 'own' },
	] }],
};
function render(data: StoreWorkspaceProducts, userId = 'owner') {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	client.setQueryData(queryKeys.account.storeProducts('tea', userId), data);
	return renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><StoreProductsPanel appId="tea" /></MemoryRouter></QueryClientProvider>);
}

describe('store products panel', () => {
	it('shows published products with real prices and functional builder actions', () => {
		const html = render(collection);
		expect(html).toContain('Green tea');
		expect(html).toContain('$14.00');
		expect(html).toContain('href="/chat/tea"');
		expect(html).toContain('Published collection');
		expect(html).not.toContain('in stock');
	});
	it('offers the builder for an unpublished store without showing fabricated products', () => {
		const html = render({ ...collection, status: 'unpublished', manifestStatus: 'unpublished', products: [], publishedAt: null, publishedCommit: null, storeUrl: null });
		expect(html).toContain('Publish your collection');
		expect(html).toContain('href="/chat/tea"');
		expect(html).not.toContain('Green tea');
	});
	it('does not show another account’s cached collection', () => {
		const html = render(collection, 'other');
		expect(html).not.toContain('Green tea');
		expect(html).toContain('Loading products');
	});
});
