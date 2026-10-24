import {
	act,
	type ButtonHTMLAttributes,
	type InputHTMLAttributes,
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
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactTestRenderer } from 'react-test-renderer';
import type { EnhancedAppData } from '@/api-types';
import { apiClient } from '@/lib/api-client';
import {
	mountElement,
	silenceTestRendererDeprecation,
	textOf,
	unmountAll,
} from '@/test-support/mounted';
import { downloadStoreList } from './store-list-export';
import AppsPage from './index';

const auth = vi.hoisted(() => ({ user: { id: 'seller' } }));
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => auth }));
vi.mock('./store-list-export', async (original) => ({
	...(await original<typeof import('./store-list-export')>()),
	downloadStoreList: vi.fn(),
}));
vi.mock('@cloudflare/kumo', async (original) => ({
	...(await original<typeof import('@cloudflare/kumo')>()),
	Button: ({
		children,
		loading: _loading,
		variant: _variant,
		size: _size,
		shape: _shape,
		...props
	}: ButtonHTMLAttributes<HTMLButtonElement> & {
		loading?: boolean;
		variant?: string;
		size?: string;
		shape?: string;
	}) => <button {...props}>{children}</button>,
	Input: (props: InputHTMLAttributes<HTMLInputElement>) => (
		<input {...props} />
	),
	Checkbox: ({
		onCheckedChange,
		indeterminate: _indeterminate,
		...props
	}: InputHTMLAttributes<HTMLInputElement> & {
		onCheckedChange: (value: boolean) => void;
		indeterminate?: boolean;
	}) => (
		<input
			{...props}
			type="checkbox"
			onChange={(event) => onCheckedChange(event.target.checked)}
		/>
	),
	Select: ({
		items,
		onValueChange,
		value,
		...props
	}: {
		items: Record<string, string>;
		onValueChange: (value: string) => void;
		value: string;
		'aria-label': string;
	}) => (
		<select
			{...props}
			value={value}
			onChange={(event) => onValueChange(event.target.value)}
		>
			{Object.entries(items).map(([key, label]) => (
				<option key={key} value={key}>
					{label}
				</option>
			))}
		</select>
	),
	Empty: ({
		title,
		description,
		contents,
	}: {
		title: string;
		description?: string;
		contents?: ReactNode;
	}) => (
		<section>
			<h2>{title}</h2>
			<p>{description}</p>
			{contents}
		</section>
	),
}));
const app = (
	id: string,
	status: 'live' | 'draft',
	visibility: 'public' | 'private' = 'private',
) =>
	({
		id,
		title: id,
		visibility,
		updatedAt: '2026-10-20T12:00:00Z',
		category: null,
		publication: {
			status,
			publishedAt: status === 'live' ? '2026-10-20T12:00:00Z' : null,
		},
	}) as unknown as EnhancedAppData;
const records = [
	app('Tea', 'live'),
	app('Public draft', 'draft', 'public'),
	app('Coffee', 'live'),
];
const clients: QueryClient[] = [];
beforeAll(silenceTestRendererDeprecation);
beforeEach(() => {
	auth.user = { id: 'seller' };
	vi.mocked(downloadStoreList).mockClear();
	vi.spyOn(apiClient, 'getUserAppsWithPagination').mockImplementation(
		async (params) => {
			const rows = records.filter(
				(row) =>
					(!params?.publication ||
						row.publication?.status === params.publication) &&
					(!params?.visibility ||
						row.visibility === params.visibility),
			);
			const offset = ((params?.page ?? 1) - 1) * 2;
			return {
				success: true,
				data: {
					apps: rows.slice(offset, offset + 2),
					pagination: {
						limit: 2,
						offset,
						total: rows.length,
						hasMore: offset + 2 < rows.length,
					},
				},
			};
		},
	);
});
afterEach(async () => {
	await unmountAll();
	clients.splice(0).forEach((client) => client.clear());
	vi.restoreAllMocks();
});
const settle = () =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 25));
	});
async function mount() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	clients.push(client);
	const renderer = await mountElement(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<AppsPage />
			</MemoryRouter>
		</QueryClientProvider>,
	);
	await settle();
	return renderer;
}
function button(renderer: ReactTestRenderer, label: string) {
	return renderer.root
		.findAllByType('button')
		.find((node) => node.children.includes(label))!;
}

describe('My stores workspace', () => {
	it('shows real publication independently of visibility and real navigation destinations', async () => {
		const renderer = await mount();
		expect(textOf(renderer)).toContain('Public draft');
		expect(textOf(renderer)).toContain('Draft');
		expect(textOf(renderer)).toContain('Live');
		const links = renderer.root
			.findAllByType('a')
			.map((node) => node.props.href);
		expect(links).toContain('/discover');
		expect(links).toContain('/build');
		expect(links).toContain('/stores/Tea');
		expect(links).toContain('/chat/Tea');
	});
	it('requests publication server-side, keeps visibility available, and loads additional pages', async () => {
		const renderer = await mount();
		await act(async () =>
			button(renderer, 'Load more stores').props.onClick(),
		);
		await settle();
		expect(textOf(renderer)).toContain('Coffee');
		await act(async () => button(renderer, 'Live').props.onClick());
		await settle();
		expect(apiClient.getUserAppsWithPagination).toHaveBeenLastCalledWith(
			expect.objectContaining({ publication: 'live', page: 1 }),
		);
		expect(textOf(renderer)).not.toContain('Public draft');
		await act(async () =>
			renderer.root
				.findByType('select')
				.props.onChange({ target: { value: 'public' } }),
		);
		await settle();
		expect(apiClient.getUserAppsWithPagination).toHaveBeenLastCalledWith(
			expect.objectContaining({
				publication: 'live',
				visibility: 'public',
				page: 1,
			}),
		);
		expect(textOf(renderer)).toContain('No stores found');
		await act(async () =>
			button(renderer, 'Clear filters').props.onClick(),
		);
		await settle();
		expect(textOf(renderer)).toContain('Public draft');
	});
	it('exports only selected rows and clears selection on filter changes', async () => {
		const renderer = await mount();
		await act(async () =>
			renderer.root
				.findByProps({ 'aria-label': 'Select Tea', type: 'checkbox' })
				.props.onChange({ target: { checked: true } }),
		);
		await act(async () =>
			button(renderer, 'Export selected').props.onClick(),
		);
		const csv = vi.mocked(downloadStoreList).mock.calls[0][0];
		expect(csv).toContain('"Tea"');
		expect(csv).not.toContain('Public draft');
		expect(csv).not.toContain('seller');
		await act(async () => button(renderer, 'Draft').props.onClick());
		await settle();
		expect(textOf(renderer)).not.toContain('Export selected');
	});
	it('selects only loaded rows and discards selection when the account changes', async () => {
		const renderer = await mount();
		await act(async () =>
			renderer.root
				.findByProps({
					'aria-label': 'Select all loaded stores',
					type: 'checkbox',
				})
				.props.onChange({ target: { checked: true } }),
		);
		expect(textOf(renderer)).toContain('2 stores selected');
		await act(async () =>
			button(renderer, 'Export selected').props.onClick(),
		);
		expect(vi.mocked(downloadStoreList).mock.calls[0][0]).not.toContain(
			'Coffee',
		);
		auth.user = { id: 'other' };
		await act(async () =>
			renderer.update(
				<QueryClientProvider client={clients[0]}>
					<MemoryRouter>
						<AppsPage />
					</MemoryRouter>
				</QueryClientProvider>,
			),
		);
		await settle();
		expect(textOf(renderer)).not.toContain('Export selected');
	});
});
