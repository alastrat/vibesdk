import {
	act,
	type ButtonHTMLAttributes,
	type HTMLAttributes,
	type ReactNode,
} from 'react';
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import type { ReactTestRenderer } from 'react-test-renderer';
import {
	SecurityError,
	SecurityErrorType,
	type AdminCatalogOrdersData,
} from '@/api-types';
import {
	mountElement,
	silenceTestRendererDeprecation,
	textOf,
	unmountAll,
} from '@/test-support/mounted';
import { AdminPage } from './admin-layout';
import AdminCatalogOrdersPage from './catalog-orders';

const state = vi.hoisted(() => ({
	data: undefined as { pages: AdminCatalogOrdersData[] } | undefined,
	error: null as Error | null,
	isLoading: false,
	hasNextPage: false,
	refetch: vi.fn(),
	fetchNextPage: vi.fn(),
	view: vi.fn(),
}));
vi.mock('@/hooks/use-admin-catalog-orders', () => ({
	useAdminCatalogOrders: (view: string) => {
		state.view(view);
		return { ...state, isFetching: false, isFetchingNextPage: false };
	},
}));
vi.mock('@cloudflare/kumo', () => {
	const Table = Object.assign(
		({ children, ...props }: HTMLAttributes<HTMLTableElement>) => (
			<table {...props}>{children}</table>
		),
		{
			Header: (props: HTMLAttributes<HTMLTableSectionElement>) => (
				<thead {...props} />
			),
			Body: (props: HTMLAttributes<HTMLTableSectionElement>) => (
				<tbody {...props} />
			),
			Row: (props: HTMLAttributes<HTMLTableRowElement>) => (
				<tr {...props} />
			),
			Cell: (props: HTMLAttributes<HTMLTableCellElement>) => (
				<td {...props} />
			),
		},
	);
	return {
		Table,
		Button: ({
			children,
			loading: _loading,
			variant: _variant,
			size: _size,
			...props
		}: ButtonHTMLAttributes<HTMLButtonElement> & {
			loading?: boolean;
			variant?: string;
			size?: string;
		}) => <button {...props}>{children}</button>,
		Tabs: ({
			value,
			tabs,
			onValueChange,
		}: {
			value: string;
			tabs: { value: string; label: string }[];
			onValueChange: (value: string) => void;
		}) => (
			<div role="tablist">
				{tabs.map((tab) => (
					<button
						key={tab.value}
						role="tab"
						aria-selected={tab.value === value}
						onClick={() => onValueChange(tab.value)}
					>
						{tab.label}
					</button>
				))}
			</div>
		),
		Badge: ({ children }: { children: ReactNode }) => (
			<span>{children}</span>
		),
		Empty: ({
			title,
			description,
		}: {
			title: string;
			description?: string;
		}) => (
			<div>
				<h2>{title}</h2>
				<p>{description}</p>
			</div>
		),
		Loader: () => <span>Loading</span>,
		buttonVariants: () => '',
	};
});
function Location() {
	return <output>{useLocation().pathname}</output>;
}
function button(renderer: ReactTestRenderer, label: string) {
	return renderer.root
		.findAllByType('button')
		.find(
			(node) =>
				node.children.join('') === label ||
				node.children.some((child) => child === label),
		)!;
}
beforeAll(silenceTestRendererDeprecation);
afterEach(unmountAll);
beforeEach(() => {
	state.data = undefined;
	state.error = null;
	state.isLoading = false;
	state.hasNextPage = false;
	vi.clearAllMocks();
});
describe('shared admin navigation and catalog order workflow', () => {
	it('routes each shared section and refreshes only on request, with catalog detail using its parent tab', async () => {
		const refresh = vi.fn();
		const renderer = await mountElement(
			<MemoryRouter initialEntries={['/admin/catalog-orders/order-1']}>
				<AdminPage
					section="catalog-orders"
					title="Catalog order"
					onRefresh={refresh}
				>
					<p>Details</p>
				</AdminPage>
				<Location />
			</MemoryRouter>,
		);
		expect(renderer.root.findAllByProps({ role: 'tab' })).toHaveLength(5);
		expect(button(renderer, 'Catalog orders').props['aria-selected']).toBe(
			true,
		);
		expect(refresh).not.toHaveBeenCalled();
		for (const [label, path] of [
			['Reviews', '/admin/reviews'],
			['Early access', '/admin/early-access'],
			['Contact requests', '/admin/contact-requests'],
			['Feature flags', '/admin/flags'],
			['Catalog orders', '/admin/catalog-orders'],
		]) {
			await act(async () => button(renderer, label).props.onClick());
			expect(renderer.root.findByType('output').children).toEqual([path]);
		}
		await act(async () => button(renderer, 'Refresh').props.onClick());
		expect(refresh).toHaveBeenCalledOnce();
	});
	it('retains attention filtering, real order links and pagination inside the table panel', async () => {
		state.data = {
			pages: [
				{
					orders: [
						{
							id: 'order-1',
							createdAt: '2026-01-01T00:00:00Z',
							status: 'needs-attention',
							mode: 'live',
							orderNumber: 42,
							storeAppId: 'store-1',
							storeTitle: 'My store',
							sellerEmail: 'owner@example.test',
							itemCounts: { pending: 2 },
							lastError: 'Supplier unavailable',
						},
					],
					nextCursor: 'next',
				},
			],
		};
		state.hasNextPage = true;
		const renderer = await mountElement(
			<MemoryRouter>
				<AdminCatalogOrdersPage />
			</MemoryRouter>,
		);
		expect(state.view).toHaveBeenLastCalledWith('attention');
		expect(textOf(renderer)).toContain('1 record');
		expect(textOf(renderer)).toContain('2 pending');
		expect(
			renderer.root.findAllByType('a').map((node) => node.props.href),
		).toContain('/admin/catalog-orders/order-1');
		expect(renderer.root.findAllByType('table')).toHaveLength(1);
		await act(async () => button(renderer, 'All orders').props.onClick());
		expect(state.view).toHaveBeenLastCalledWith('all');
		await act(async () => button(renderer, 'Load more').props.onClick());
		expect(state.fetchNextPage).toHaveBeenCalledOnce();
	});
	it('keeps forbidden responses out of the data table', async () => {
		state.error = new SecurityError(
			SecurityErrorType.FORBIDDEN,
			'Access denied',
			403,
		);
		const renderer = await mountElement(
			<MemoryRouter>
				<AdminCatalogOrdersPage />
			</MemoryRouter>,
		);
		expect(textOf(renderer)).toContain('Admins only');
		expect(textOf(renderer)).toContain('Access denied');
		expect(renderer.root.findAllByType('table')).toHaveLength(0);
		expect(state.fetchNextPage).not.toHaveBeenCalled();
	});
	it('shows the all-orders empty state after switching views', async () => {
		state.data = { pages: [{ orders: [], nextCursor: null }] };
		const renderer = await mountElement(
			<MemoryRouter>
				<AdminCatalogOrdersPage />
			</MemoryRouter>,
		);
		expect(textOf(renderer)).toContain('Nothing needs you');
		await act(async () => button(renderer, 'All orders').props.onClick());
		expect(textOf(renderer)).toContain('No catalog orders yet');
		expect(
			renderer.root
				.findAllByType('button')
				.some((node) => node.children.join('') === 'Load more'),
		).toBe(false);
	});
});
