import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/lib/query-keys';
import type { CatalogProductView } from '@/api-types';
import CatalogPage from './index';
vi.mock('@/contexts/auth-context', () => ({
	useAuth: () => ({ user: { id: 'owner' } }),
}));
vi.mock('@/hooks/use-apps', () => ({
	useApps: () => ({
		apps: [
			{ id: 'tea', title: 'Tea shop', userId: 'owner' },
			{ id: 'other', title: 'Other shop', userId: 'someone-else' },
		],
		loading: false,
		error: null,
	}),
}));
vi.mock('@/hooks/use-flag', () => ({ useFlag: () => false }));
const product: CatalogProductView = {
	productId: 'cup',
	title: 'Tea cup',
	description: 'Ceramic',
	category: 'Kitchen',
	imageUrls: [],
	shipsTo: ['US'],
	variants: [
		{
			catalogVariantId: 'small',
			name: 'Small',
			options: {},
			imageUrl: null,
			available: true,
			deliveryDays: { min: 3, max: 7 },
			catalogPriceCents: 500,
			minimumRetailPriceCents: 800,
			suggestedRetailPriceCents: 999,
		},
	],
};
function render(path: string) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	client.setQueryData(queryKeys.account.catalog.products(''), {
		products: [product],
	});
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={[path]}>
				<CatalogPage />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}
describe('catalog store context', () => {
	it('keeps the selected owned store and offers direct catalog import', () => {
		const html = render('/catalog?store=tea&tab=estori');
		expect(html).toContain('Add to this store');
		expect(html).toContain('href="/stores/tea?section=products"');
		expect(html).not.toContain('Start a store with this');
	});
	it('does not hand off to an unowned store or silently select another store', () => {
		const html = render('/catalog?store=other&tab=estori');
		expect(html).toContain('Choose one of your stores to continue.');
		expect(html).not.toContain('Add to this store');
		expect(html).not.toContain('href="/stores/other');
	});
});
