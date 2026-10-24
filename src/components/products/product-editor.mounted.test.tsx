import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, type ComponentProps, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type {
	AccountProduct,
	ApiResponse,
	StoreProductCollection,
} from '@/api-types';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import {
	mountElement,
	silenceTestRendererDeprecation,
	textOf,
	unmountAll,
} from '@/test-support/mounted';
import { StoreProductsPanel } from '@/routes/store-workspace/products';
import { ProductEditor } from './product-editor';
import CatalogPage from '@/routes/catalog';
import {
	usePrivateProducts,
	useStoreProductCollection,
} from '@/hooks/use-private-products';
import { CatalogPicker } from './catalog-picker';
import { useCatalogProducts } from '@/hooks/use-catalog';
import type { CatalogProductView } from '@/api-types';
vi.mock('@/contexts/auth-context', () => ({
	useAuth: () => ({ user: { id: 'owner' } }),
}));
vi.mock('@/hooks/use-private-products', () => ({
	useRefreshProducts: () => async () => {},
	usePrivateProducts: vi.fn(() => ({ data: { products: [] } })),
	useStoreProductCollection: vi.fn(() => ({ data: { products: [] } })),
}));
vi.mock('@/hooks/use-apps', () => ({
	useApps: () => ({
		apps: [
			{ id: 'a', userId: 'owner', title: 'Store A' },
			{ id: 'b', userId: 'owner', title: 'Store B' },
		],
		loading: false,
	}),
}));
vi.mock('@/hooks/use-catalog', () => ({
	useCatalogProducts: vi.fn(() => ({ data: { products: [] } })),
}));
vi.mock('@/hooks/use-flag', () => ({ useFlag: () => false }));
vi.mock('@/lib/api-client', () => ({
	apiClient: {
		getStoreCollection: vi.fn(),
		createAccountProduct: vi.fn(),
		updateAccountProduct: vi.fn(),
		updateStoreProduct: vi.fn(),
		addStoreProduct: vi.fn(),
	},
}));
vi.mock('@cloudflare/kumo', () => {
	const Box = ({ children }: { children?: ReactNode }) => (
		<div>{children}</div>
	);
	const Dialog = Object.assign(Box, {
		Root: Box,
		Title: Box,
		Description: Box,
	});
	return {
		Dialog,
		Textarea: (props: ComponentProps<'textarea'>) => (
			<textarea {...props} />
		),
		Table: Object.assign(
			({ children, ...props }: ComponentProps<'table'>) => (
				<table {...props}>{children}</table>
			),
			{
				Header: (props: ComponentProps<'thead'>) => (
					<thead {...props} />
				),
				Body: (props: ComponentProps<'tbody'>) => <tbody {...props} />,
				Row: (props: ComponentProps<'tr'>) => <tr {...props} />,
				Head: (props: ComponentProps<'th'>) => <th {...props} />,
				Cell: (props: ComponentProps<'td'>) => <td {...props} />,
			},
		),
		DropdownMenu: Object.assign(Box, {
			Trigger: ({ render }: { render: ReactNode }) => render,
			Content: () => null,
			CheckboxItem: Box,
			Item: Box,
		}),
		Button: (props: ComponentProps<'button'>) => <button {...props} />,
		Input: (props: ComponentProps<'input'>) => <input {...props} />,
		Checkbox: ({
			onCheckedChange,
			...props
		}: {
			onCheckedChange: (checked: boolean) => void;
			checked: boolean;
		}) => (
			<input
				{...props}
				type="checkbox"
				onChange={() => onCheckedChange(!props.checked)}
			/>
		),
		Switch: ({
			onCheckedChange,
			...props
		}: {
			onCheckedChange: (checked: boolean) => void;
			checked: boolean;
		}) => (
			<input
				{...props}
				type="checkbox"
				onChange={() => onCheckedChange(!props.checked)}
			/>
		),
		Select: ({
			value,
			onValueChange,
			items,
			...props
		}: {
			value: string;
			onValueChange: (value: string) => void;
			items: Record<string, string>;
		}) => (
			<select
				{...props}
				value={value}
				onChange={(e) => onValueChange(e.target.value)}
			>
				{Object.entries(items).map(([id, label]) => (
					<option key={id} value={id}>
						{label}
					</option>
				))}
			</select>
		),
		LayerCard: Object.assign(Box, { Primary: Box }),
		Empty: Box,
		Loader: Box,
	};
});
const product: AccountProduct = {
	id: 'coffee',
	name: 'Coffee',
	description: 'Fresh',
	category: 'Coffee',
	type: 'physical',
	source: 'own',
	sourceCatalogProductId: null,
	variants: [
		{
			id: 'bag',
			name: 'Bag',
			priceCents: 1500,
			sku: 'COF',
			available: true,
		},
	],
	image: null,
	downloads: [],
	weightGrams: 250,
	archived: false,
	revision: 1,
	createdAt: '',
	updatedAt: '',
};
const ok = <T,>(data: T): ApiResponse<T> => ({ success: true, data });
async function settle() {
	for (let i = 0; i < 3; i++)
		await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
beforeAll(() => {
	silenceTestRendererDeprecation();
	vi.stubGlobal('window', {
		addEventListener() {},
		removeEventListener() {},
	});
});
afterEach(async () => {
	await unmountAll();
	vi.clearAllMocks();
});
function wrapper(
	children: ReactNode,
	client = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	}),
) {
	return (
		<QueryClientProvider client={client}>
			<MemoryRouter>{children}</MemoryRouter>
		</QueryClientProvider>
	);
}
describe('product editor interactions', () => {
	it('opens a managed row in the actual editor without importing it', async () => {
		const client = new QueryClient();
		const collection: StoreProductCollection = {
			appId: 'store',
			currency: 'usd',
			hasUnpublishedChanges: false,
			products: [
				{
					id: 'listing',
					product,
					visibility: 'visible',
					published: true,
					pendingChanges: false,
					revenueCents: 0,
					orders: 0,
					customers: 0,
					unitsSold: 0,
				},
			],
		};
		client.setQueryData(
			queryKeys.privateProducts.collection('owner', 'store'),
			collection,
		);
		vi.mocked(apiClient.getStoreCollection).mockResolvedValue(
			ok(collection),
		);
		const renderer = await mountElement(
			wrapper(<StoreProductsPanel appId="store" />, client),
		);
		const rowButton = renderer.root
			.findAllByType('button')
			.find((node) => node.props.className?.includes('min-w-52'))!;
		await act(async () => rowButton.props.onClick());
		expect(textOf(renderer)).toContain('Edit product');
		expect(
			renderer.root
				.findAllByType('input')
				.some((node) => node.props.value === 'Coffee'),
		).toBe(true);
		expect(apiClient.addStoreProduct).not.toHaveBeenCalled();
	});
	it('creates a private store product from typed form values', async () => {
		const close = vi.fn();
		vi.mocked(apiClient.createAccountProduct).mockResolvedValue(
			ok(product),
		);
		const renderer = await mountElement(
			wrapper(<ProductEditor storeId="store" onClose={close} />),
		);
		const name = renderer.root
			.findAllByType('input')
			.find(
				(node) => node.props.placeholder === 'Give your product a name',
			)!;
		const price = renderer.root
			.findAllByType('input')
			.find((node) => node.props.min === '0.50')!;
		await act(async () => {
			name.props.onChange({ target: { value: 'Coffee' } });
			price.props.onChange({ target: { value: '15.00' } });
		});
		await act(async () =>
			renderer.root
				.findByType('form')
				.props.onSubmit({ preventDefault() {} }),
		);
		await settle();
		expect(apiClient.createAccountProduct).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Coffee',
				storeId: 'store',
				visibility: 'visible',
				variants: [
					expect.objectContaining({ priceCents: 1500, id: '' }),
				],
			}),
		);
		expect(close).toHaveBeenCalledOnce();
	});
	it('keeps the new revision after product save when visibility fails, so retry succeeds', async () => {
		const close = vi.fn();
		vi.mocked(apiClient.updateAccountProduct).mockResolvedValue(
			ok({ ...product, revision: 2 }),
		);
		vi.mocked(apiClient.updateStoreProduct)
			.mockRejectedValueOnce(new Error('Visibility failed'))
			.mockResolvedValueOnce(
				ok({
					id: 'listing',
					product,
					visibility: 'hidden',
					published: false,
					pendingChanges: true,
					revenueCents: 0,
					orders: 0,
					customers: 0,
					unitsSold: 0,
				}),
			);
		const renderer = await mountElement(
			wrapper(
				<ProductEditor
					product={product}
					storeId="store"
					onClose={close}
				/>,
			),
		);
		const visibility = renderer.root
			.findAllByType('input')
			.find((node) => node.props['aria-label'] === 'Visible in store')!;
		await act(async () => visibility.props.onChange());
		await act(async () =>
			renderer.root
				.findByType('form')
				.props.onSubmit({ preventDefault() {} }),
		);
		await settle();
		expect(textOf(renderer)).toContain('Visibility failed');
		expect(close).not.toHaveBeenCalled();
		await act(async () =>
			renderer.root
				.findByType('form')
				.props.onSubmit({ preventDefault() {} }),
		);
		await settle();
		expect(
			vi.mocked(apiClient.updateAccountProduct).mock.calls[1][1].revision,
		).toBe(2);
		expect(
			vi.mocked(apiClient.updateAccountProduct).mock.calls[0][1]
				.variants[0].id,
		).toBe('bag');
		expect(close).toHaveBeenCalledOnce();
	});
});

it.each(['mine', 'estori'] as const)(
	'resets %s catalog attach state when switching stores and creates into the selected store',
	async (tab) => {
		vi.mocked(usePrivateProducts).mockReturnValue({
			data: { products: [product] },
		} as ReturnType<typeof usePrivateProducts>);
		const supplier: CatalogProductView = {
			productId: 'cup',
			title: 'Cup',
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
		vi.mocked(useCatalogProducts).mockReturnValue({
			data: { products: [supplier] },
		} as ReturnType<typeof useCatalogProducts>);
		vi.mocked(apiClient.addStoreProduct).mockResolvedValue(
			ok({
				id: 'listing',
				product,
				visibility: 'visible',
				published: false,
				pendingChanges: true,
				revenueCents: 0,
				orders: 0,
				customers: 0,
				unitsSold: 0,
			}),
		);
		const client = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
		const renderer = await mountElement(
			<QueryClientProvider client={client}>
				<MemoryRouter initialEntries={[`/catalog?store=a&tab=${tab}`]}>
					<CatalogPage />
				</MemoryRouter>
			</QueryClientProvider>,
		);
		const addLabel = tab === 'mine' ? 'Add to store' : 'Add to this store';
		const addButton = () =>
			renderer.root
				.findAllByType('button')
				.find((node) => node.children.includes(addLabel))!;
		await act(async () => addButton().props.onClick());
		await settle();
		expect(apiClient.addStoreProduct).toHaveBeenLastCalledWith(
			'a',
			tab === 'mine'
				? { productId: product.id }
				: { catalogProductId: supplier.productId },
		);
		expect(textOf(renderer)).toContain('Added to store');
		const storePicker = renderer.root
			.findAllByType('select')
			.find(
				(node) =>
					node.props['aria-label'] === 'Store for catalog products',
			)!;
		await act(async () =>
			storePicker.props.onChange({ target: { value: 'b' } }),
		);
		expect(addButton().props.disabled).toBeFalsy();
		await act(async () => addButton().props.onClick());
		await settle();
		expect(apiClient.addStoreProduct).toHaveBeenLastCalledWith(
			'b',
			tab === 'mine'
				? { productId: product.id }
				: { catalogProductId: supplier.productId },
		);
		if (tab === 'mine') {
			vi.mocked(apiClient.createAccountProduct).mockResolvedValue(
				ok(product),
			);
			await act(async () =>
				renderer.root
					.findAllByType('button')
					.find((node) => node.children.includes('Create product'))!
					.props.onClick(),
			);
			const name = renderer.root
				.findAllByType('input')
				.find(
					(node) =>
						node.props.placeholder === 'Give your product a name',
				)!;
			const price = renderer.root
				.findAllByType('input')
				.find((node) => node.props.min === '0.50')!;
			await act(async () => {
				name.props.onChange({ target: { value: 'New coffee' } });
				price.props.onChange({ target: { value: '15.00' } });
			});
			await act(async () =>
				renderer.root
					.findByType('form')
					.props.onSubmit({ preventDefault() {} }),
			);
			await settle();
			expect(apiClient.createAccountProduct).toHaveBeenCalledWith(
				expect.objectContaining({ storeId: 'b', name: 'New coffee' }),
			);
		}
	},
);

it('marks hidden attached products and supplier imports as added while allowing a detached product to be re-added', async () => {
	const detached = {
		...product,
		id: 'detached-product',
		name: 'Detached coffee',
	};
	const imported = {
		...product,
		id: 'imported-cup',
		source: 'catalog' as const,
		sourceCatalogProductId: 'cup',
	};
	vi.mocked(usePrivateProducts).mockReturnValue({
		data: { products: [product, detached] },
	} as ReturnType<typeof usePrivateProducts>);
	const listing = (p: AccountProduct) => ({
		id: p.id,
		product: p,
		visibility: 'hidden' as const,
		published: true,
		pendingChanges: true,
		revenueCents: 0,
		orders: 0,
		customers: 0,
		unitsSold: 0,
	});
	vi.mocked(useStoreProductCollection).mockReturnValue({
		data: {
			appId: 'b',
			currency: 'usd',
			hasUnpublishedChanges: true,
			products: [listing(product), listing(imported)],
		},
	} as ReturnType<typeof useStoreProductCollection>);
	const supplier: CatalogProductView = {
		productId: 'cup',
		title: 'Cup',
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
	vi.mocked(useCatalogProducts).mockReturnValue({
		data: { products: [supplier] },
	} as ReturnType<typeof useCatalogProducts>);
	vi.mocked(apiClient.addStoreProduct).mockResolvedValue(
		ok(listing(detached)),
	);
	const renderer = await mountElement(
		wrapper(<CatalogPicker storeId="b" onClose={() => {}} />),
	);
	const addedButton = () =>
		renderer.root
			.findAllByType('button')
			.find((node) => node.children.includes('Added to store'))!;
	expect(addedButton().props.disabled).toBe(true);
	const readd = renderer.root
		.findAllByType('button')
		.find((node) => node.children.includes('Add to store'))!;
	expect(readd.props.disabled).toBeFalsy();
	await act(async () => readd.props.onClick());
	await settle();
	expect(apiClient.addStoreProduct).toHaveBeenCalledOnce();
	expect(apiClient.addStoreProduct).toHaveBeenCalledWith('b', {
		productId: detached.id,
	});
	await act(async () =>
		renderer.root
			.findAllByType('button')
			.find((node) => node.children.includes('Estori catalog'))!
			.props.onClick(),
	);
	expect(addedButton().props.disabled).toBe(true);
	expect(
		renderer.root
			.findAllByType('button')
			.some((node) => node.children.includes('Add to store')),
	).toBe(false);
	expect(
		renderer.root
			.findAllByType('input')
			.find((node) => node.props.type === 'search')!.props.className,
	).toContain('w-full');
});
