import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { StoreProductCollection } from '@/api-types';
import { queryKeys } from '@/lib/query-keys';
import { StoreProductsPanel } from './products';

vi.mock('@/contexts/auth-context', () => ({
	useAuth: () => ({ user: { id: 'owner' } }),
}));
vi.mock('@/hooks/use-flag', () => ({ useFlag: () => false }));
const collection: StoreProductCollection = {
	appId: 'tea',
	currency: 'usd',
	hasUnpublishedChanges: true,
	products: [
		{
			id: 'listing-tea',
			visibility: 'visible',
			published: false,
			pendingChanges: true,
			revenueCents: 0,
			orders: 0,
			customers: 0,
			unitsSold: 0,
			product: {
				id: 'tea-product',
				name: 'Green tea',
				description: 'Whole leaf',
				category: 'Tea',
				type: 'physical',
				source: 'own',
				sourceCatalogProductId: null,
				image: null,
				downloads: [],
				weightGrams: 100,
				archived: false,
				revision: 1,
				createdAt: '',
				updatedAt: '',
				variants: [
					{
						id: 'box',
						name: 'Box',
						priceCents: 1400,
						available: true,
						sku: 'TEA',
					},
				],
			},
		},
	],
};
function render(data: StoreProductCollection, userId = 'owner') {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	client.setQueryData(
		queryKeys.privateProducts.collection(userId, 'tea'),
		data,
	);
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<StoreProductsPanel appId="tea" />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe('store products panel', () => {
	it('shows private store products with their real price and create, catalog and publication actions', () => {
		const html = render(collection);
		expect(html).toContain('Green tea');
		expect(html).toContain('$14.00');
		expect(html).toContain('Create product');
		expect(html).toContain('Review and publish');
		expect(html).toContain('Unpublished changes');
		expect(html).toContain('Add from catalog');
		expect(html).not.toContain('in stock');
	});
	it('offers real creation and catalog controls for an empty private collection', () => {
		const html = render({
			...collection,
			hasUnpublishedChanges: false,
			products: [],
		});
		expect(html).toContain(
			'Create your first product or add one from your catalog.',
		);
		expect(html).toContain('Create product');
		expect(html).toContain('Add from catalog');
		expect(html).not.toContain('Review and publish');
		expect(html).not.toContain('Green tea');
	});
	it('does not show another account’s cached collection', () => {
		const html = render(collection, 'other');
		expect(html).not.toContain('Green tea');
		expect(html).toContain('role="status"');
	});
});
