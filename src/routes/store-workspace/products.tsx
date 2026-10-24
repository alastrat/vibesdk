import { lazy, Suspense, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
	Button,
	Checkbox,
	DropdownMenu,
	Input,
	Loader,
	Select,
	Table,
} from '@cloudflare/kumo';
import {
	PlusIcon,
	DownloadSimpleIcon,
	SlidersHorizontalIcon,
	DotsThreeIcon,
	PackageIcon,
} from '@phosphor-icons/react';
import type {
	AccountProduct,
	StoreProductListing,
	ProductVisibility,
} from '@/api-types';
import { useAuth } from '@/contexts/auth-context';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';
import { getLocale, t, tn, useI18n, msg } from '@/lib/i18n';
import { formatCents } from '@/lib/pricing';
const GoLiveDialog = lazy(() =>
	import('@/components/live-store/GoLiveDialog').then((module) => ({
		default: module.GoLiveDialog,
	})),
);
import { ProductEditor } from '@/components/products/product-editor';
import { CatalogPicker } from '@/components/products/catalog-picker';
import { csvCell } from '@/components/products/product-utils';
import { useRefreshProducts } from '@/hooks/use-private-products';
import '@/components/products/products.css';
const money = (cents: number) => formatCents(cents, getLocale());
const columns = [
	msg('Price'),
	msg('Visibility'),
	msg('Type'),
	msg('Source'),
	msg('Sales'),
	msg('Revenue'),
	msg('Customers'),
] as const;
type Column = (typeof columns)[number];
export function StoreProductsPanel({ appId }: { appId: string }) {
	useI18n();
	const { user } = useAuth();
	const [params] = useSearchParams();
	const mode = params.get('mode') === 'test' ? 'test' : 'live';
	const collection = useQuery({
		queryKey: queryKeys.privateProducts.collection(user?.id, appId, mode),
		queryFn: () =>
			unwrap(
				apiClient.getStoreCollection(appId, mode),
				t("Couldn't load your products"),
			),
		enabled: !!user && !!appId,
		retry: false,
	});
	const refresh = useRefreshProducts();
	const [search, setSearch] = useState('');
	const [visibility, setVisibility] = useState('all');
	const [type, setType] = useState('all');
	const [selected, setSelected] = useState<string[]>([]);
	const [hiddenColumns, setHiddenColumns] = useState<Column[]>([]);
	const [page, setPage] = useState(1);
	const [size, setSize] = useState('20');
	const [editor, setEditor] = useState<AccountProduct | 'new' | null>(null);
	const [picker, setPicker] = useState(false);
	const [publishing, setPublishing] = useState(false);
	const mutation = useMutation({
		mutationFn: async ({
			ids,
			value,
		}: {
			ids: string[];
			value: ProductVisibility | 'remove';
		}) => {
			for (const id of ids) {
				if (value === 'remove')
					await unwrap(
						apiClient.removeStoreProduct(appId, id),
						t("Couldn't update the product"),
					);
				else
					await unwrap(
						apiClient.updateStoreProduct(appId, id, {
							visibility: value,
						}),
						t("Couldn't update the product"),
					);
			}
		},
		onSuccess: async () => {
			setSelected([]);
			await refresh();
		},
		onError: async () => {
			await refresh();
		},
	});
	const importPublished = useMutation({
		mutationFn: (publishedProductId: string) =>
			unwrap(
				apiClient.addStoreProduct(appId, { publishedProductId }),
				t("Couldn't import the product"),
			),
		onSuccess: async (listing) => {
			await refresh();
			setEditor(listing.product);
		},
	});
	const openProduct = (row: StoreProductListing) => {
		if (row.id.startsWith('published:'))
			importPublished.mutate(row.product.id);
		else setEditor(row.product);
	};
	const filtered = (collection.data?.products ?? []).filter(
		(row) =>
			`${row.product.name} ${row.product.description}`
				.toLowerCase()
				.includes(search.toLowerCase()) &&
			(visibility === 'all' || row.visibility === visibility) &&
			(type === 'all' || row.product.type === type),
	);
	const pages = Math.max(1, Math.ceil(filtered.length / Number(size)));
	const currentPage = Math.min(page, pages);
	const rows = filtered.slice(
		(currentPage - 1) * Number(size),
		currentPage * Number(size),
	);
	const checked =
		rows.some((r) => !r.id.startsWith('published:')) &&
		rows
			.filter((r) => !r.id.startsWith('published:'))
			.every((r) => selected.includes(r.product.id));
	const toggle = (id: string) =>
		setSelected((current) =>
			current.includes(id)
				? current.filter((x) => x !== id)
				: [...current, id],
		);
	const exportCsv = () => {
		const lines = [
			[t('Name'), ...columns.map((c) => t(c))],
			...filtered.map((row) => [
				row.product.name,
				Math.min(...row.product.variants.map((v) => v.priceCents)) /
					100,
				row.visibility === 'visible' ? t('Visible') : t('Hidden'),
				row.product.type === 'digital' ? t('Digital') : t('Physical'),
				row.product.source === 'own'
					? t('My products')
					: t('Estori catalog'),
				row.unitsSold,
				row.revenueCents / 100,
				row.customers,
			]),
		];
		const url = URL.createObjectURL(
			new Blob(
				[
					'\uFEFF' +
						lines
							.map((line) => line.map(csvCell).join(','))
							.join('\r\n'),
				],
				{ type: 'text/csv;charset=utf-8' },
			),
		);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'products.csv';
		link.click();
		URL.revokeObjectURL(url);
	};
	const cell = (column: Column, row: StoreProductListing) => {
		const product = row.product;
		if (column === 'Price') {
			const prices = product.variants.map((v) => v.priceCents);
			const low = Math.min(...prices),
				high = Math.max(...prices);
			return low === high ? money(low) : `${money(low)} – ${money(high)}`;
		}
		if (column === 'Visibility')
			return (
				<span className="inline-flex rounded-md bg-kumo-recessed px-2 py-1 text-xs">
					{row.visibility === 'visible' ? t('Visible') : t('Hidden')}
				</span>
			);
		if (column === 'Type')
			return product.type === 'digital' ? t('Digital') : t('Physical');
		if (column === 'Source')
			return product.source === 'own'
				? t('My products')
				: t('Estori catalog');
		if (column === 'Sales') return row.unitsSold;
		if (column === 'Revenue') return money(row.revenueCents);
		return row.customers;
	};
	return (
		<div className="grid gap-5">
			<header className="flex flex-wrap items-center justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight text-kumo-strong">
						{t('Products')}
					</h1>
					<p className="mt-1 text-sm text-kumo-subtle">
						{t('Manage the products you sell in this store.')}
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						variant="secondary"
						size="sm"
						onClick={() => setPicker(true)}
					>
						{t('Add from catalog')}
					</Button>
					<Button
						variant="primary"
						size="sm"
						onClick={() => setEditor('new')}
					>
						<PlusIcon size={16} />
						{t('Create product')}
					</Button>
				</div>
			</header>
			{collection.data?.hasUnpublishedChanges && (
				<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-kumo-line bg-kumo-recessed px-4 py-3 text-sm">
					<span>
						{t('Unpublished changes')}
						<span className="ml-2 text-kumo-subtle">
							{t(
								'Publish your store to make these products live.',
							)}
						</span>
					</span>
					<Button
						size="sm"
						variant="secondary"
						onClick={() => setPublishing(true)}
					>
						{t('Review and publish')}
					</Button>
				</div>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<div className="relative min-w-48 grow sm:max-w-72">
					<Input
						type="search"
						size="sm"
						value={search}
						onChange={(e) => {
							setSearch(e.target.value);
							setPage(1);
						}}
						placeholder={t('Search products')}
						aria-label={t('Search products')}
					/>
				</div>
				<Select
					aria-label={t('Visibility')}
					value={visibility}
					onValueChange={(v) => {
						setVisibility(String(v));
						setPage(1);
					}}
					items={{
						all: t('All visibility'),
						visible: t('Visible'),
						hidden: t('Hidden'),
					}}
				/>
				<Select
					aria-label={t('Product type')}
					value={type}
					onValueChange={(v) => {
						setType(String(v));
						setPage(1);
					}}
					items={{
						all: t('All types'),
						physical: t('Physical'),
						digital: t('Digital'),
					}}
				/>
				<div className="ml-auto flex gap-2">
					<Button
						variant="secondary"
						size="sm"
						onClick={exportCsv}
						disabled={!filtered.length}
					>
						<DownloadSimpleIcon size={16} />
						{t('Export')}
					</Button>
					<DropdownMenu>
						<DropdownMenu.Trigger
							render={
								<Button
									variant="secondary"
									size="sm"
									aria-label={t('Table settings')}
								>
									<SlidersHorizontalIcon size={17} />
								</Button>
							}
						/>
						<DropdownMenu.Content>
							{columns.map((column) => (
								<DropdownMenu.CheckboxItem
									key={column}
									closeOnClick={false}
									checked={!hiddenColumns.includes(column)}
									onCheckedChange={() =>
										setHiddenColumns((current) =>
											current.includes(column)
												? current.filter(
														(c) => c !== column,
													)
												: [...current, column],
										)
									}
								>
									{t(column)}
								</DropdownMenu.CheckboxItem>
							))}
						</DropdownMenu.Content>
					</DropdownMenu>
				</div>
			</div>
			{selected.length > 0 && (
				<div className="flex flex-wrap items-center gap-3 text-sm">
					<span>
						{tn(
							'{count} selected',
							'{count} selected',
							selected.length,
						)}
					</span>
					<Button
						size="sm"
						variant="secondary"
						disabled={mutation.isPending}
						onClick={() =>
							mutation.mutate({ ids: selected, value: 'visible' })
						}
					>
						{t('Show in store')}
					</Button>
					<Button
						size="sm"
						variant="secondary"
						disabled={mutation.isPending}
						onClick={() =>
							mutation.mutate({ ids: selected, value: 'hidden' })
						}
					>
						{t('Hide in store')}
					</Button>
					<Button
						size="sm"
						variant="ghost"
						onClick={() => setSelected([])}
					>
						{t('Clear selection')}
					</Button>
				</div>
			)}
			{importPublished.error && (
				<p role="alert" className="text-sm text-red-600">
					{importPublished.error.message}
				</p>
			)}
			{mutation.error && (
				<p role="alert" className="text-sm text-red-600">
					{mutation.error.message}
				</p>
			)}
			{collection.isLoading ? (
				<div className="flex justify-center py-20">
					<Loader />
				</div>
			) : collection.isError ? (
				<div role="alert" className="py-10">
					<p>{collection.error.message}</p>
					<Button size="sm" onClick={() => void collection.refetch()}>
						{t('Try again')}
					</Button>
				</div>
			) : (
				<>
					<div className="overflow-x-auto pb-12">
						<Table className="private-products-table">
							<caption className="sr-only">
								{t('Store products')}
							</caption>
							<Table.Header>
								<Table.Row>
									<Table.Head>
										<Checkbox
											aria-label={t(
												'Select all products on this page',
											)}
											checked={checked}
											onCheckedChange={() =>
												setSelected((current) =>
													checked
														? current.filter(
																(id) =>
																	!rows.some(
																		(r) =>
																			r
																				.product
																				.id ===
																			id,
																	),
															)
														: [
																...new Set([
																	...current,
																	...rows
																		.filter(
																			(
																				r,
																			) =>
																				!r.id.startsWith(
																					'published:',
																				),
																		)
																		.map(
																			(
																				r,
																			) =>
																				r
																					.product
																					.id,
																		),
																]),
															],
												)
											}
										/>
									</Table.Head>
									<Table.Head>{t('Name')}</Table.Head>
									{columns
										.filter(
											(c) => !hiddenColumns.includes(c),
										)
										.map((c) => (
											<Table.Head key={c}>
												{t(c)}
											</Table.Head>
										))}
									<Table.Head>
										<span className="sr-only">
											{t('Actions')}
										</span>
									</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{rows.map((row) => (
									<Table.Row key={row.product.id}>
										<Table.Cell>
											<Checkbox
												disabled={row.id.startsWith(
													'published:',
												)}
												checked={selected.includes(
													row.product.id,
												)}
												aria-label={t('Select {name}', {
													name: row.product.name,
												})}
												onCheckedChange={() =>
													toggle(row.product.id)
												}
											/>
										</Table.Cell>
										<Table.Cell>
											<button
												className="flex min-w-52 items-center gap-3 text-left font-medium"
												onClick={() => openProduct(row)}
											>
												<span className="product-thumb">
													{row.product.image ? (
														<img
															src={
																row.product
																	.image.url
															}
															alt=""
															className="size-full rounded-md object-cover"
														/>
													) : (
														<PackageIcon
															size={18}
														/>
													)}
												</span>
												<span>
													{row.product.name}
													{row.pendingChanges && (
														<span className="mt-0.5 block text-[11px] font-normal text-kumo-subtle">
															{t(
																'Unpublished changes',
															)}
														</span>
													)}
												</span>
											</button>
										</Table.Cell>
										{columns
											.filter(
												(c) =>
													!hiddenColumns.includes(c),
											)
											.map((c) => (
												<Table.Cell key={c}>
													{cell(c, row)}
												</Table.Cell>
											))}
										<Table.Cell>
											<DropdownMenu>
												<DropdownMenu.Trigger
													render={
														<Button
															variant="ghost"
															size="sm"
															aria-label={t(
																'Actions for {name}',
																{
																	name: row
																		.product
																		.name,
																},
															)}
														>
															<DotsThreeIcon
																size={22}
																weight="bold"
															/>
														</Button>
													}
												/>
												<DropdownMenu.Content>
													{row.id.startsWith(
														'published:',
													) ? (
														<DropdownMenu.Item
															disabled={
																importPublished.isPending
															}
															onClick={() =>
																openProduct(row)
															}
														>
															{t(
																'Import to edit',
															)}
														</DropdownMenu.Item>
													) : (
														<>
															<DropdownMenu.Item
																onClick={() =>
																	openProduct(
																		row,
																	)
																}
															>
																{t(
																	'Edit product',
																)}
															</DropdownMenu.Item>
															<DropdownMenu.Item
																disabled={
																	mutation.isPending
																}
																onClick={() =>
																	mutation.mutate(
																		{
																			ids: [
																				row
																					.product
																					.id,
																			],
																			value:
																				row.visibility ===
																				'visible'
																					? 'hidden'
																					: 'visible',
																		},
																	)
																}
															>
																{row.visibility ===
																'visible'
																	? t(
																			'Hide in store',
																		)
																	: t(
																			'Show in store',
																		)}
															</DropdownMenu.Item>
															<DropdownMenu.Item
																disabled={
																	mutation.isPending
																}
																onClick={() =>
																	mutation.mutate(
																		{
																			ids: [
																				row
																					.product
																					.id,
																			],
																			value: 'remove',
																		},
																	)
																}
															>
																{t(
																	'Remove from store',
																)}
															</DropdownMenu.Item>
														</>
													)}
												</DropdownMenu.Content>
											</DropdownMenu>
										</Table.Cell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
						{!rows.length && (
							<div className="grid justify-items-center gap-3 py-16 text-center">
								<PackageIcon
									size={32}
									className="text-kumo-subtle"
								/>
								<strong className="text-sm">
									{t('No products found.')}
								</strong>
								<p className="text-sm text-kumo-subtle">
									{search ||
									visibility !== 'all' ||
									type !== 'all'
										? t('Try another search or filter.')
										: t(
												'Create your first product or add one from your catalog.',
											)}
								</p>
							</div>
						)}
					</div>
					<footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-kumo-subtle">
						<span>
							{tn(
								'{count} product',
								'{count} products',
								filtered.length,
							)}
						</span>
						<div className="flex items-center gap-3">
							<label className="flex items-center gap-2">
								{t('Rows per page')}
								<Select
									aria-label={t('Rows per page')}
									value={size}
									onValueChange={(v) => {
										setSize(String(v));
										setPage(1);
									}}
									items={{
										'20': '20',
										'25': '25',
										'50': '50',
									}}
								/>
							</label>
							<span>
								{t('Page {page} of {pages}', {
									page: currentPage,
									pages,
								})}
							</span>
							<Button
								variant="ghost"
								size="sm"
								disabled={currentPage <= 1}
								onClick={() => setPage(currentPage - 1)}
							>
								{t('Previous')}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								disabled={currentPage >= pages}
								onClick={() => setPage(currentPage + 1)}
							>
								{t('Next')}
							</Button>
						</div>
					</footer>
				</>
			)}
			<Suspense fallback={<Loader />}>
				{publishing && (
					<GoLiveDialog
						appId={appId}
						open={publishing}
						onOpenChange={(open) => {
							setPublishing(open);
							if (!open) void refresh();
						}}
					/>
				)}
			</Suspense>
			{editor && (
				<ProductEditor
					key={editor === 'new' ? 'new' : editor.id}
					product={editor === 'new' ? undefined : editor}
					storeId={appId}
					visibility={
						editor === 'new'
							? 'visible'
							: collection.data?.products.find(
									(r) => r.product.id === editor.id,
								)?.visibility
					}
					onClose={() => setEditor(null)}
				/>
			)}
			{picker && (
				<CatalogPicker
					storeId={appId}
					onClose={() => setPicker(false)}
				/>
			)}
		</div>
	);
}
