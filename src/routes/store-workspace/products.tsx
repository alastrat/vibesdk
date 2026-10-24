import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
	Badge,
	Button,
	Dialog,
	Empty,
	Input,
	Loader,
	Table,
	buttonVariants,
} from '@cloudflare/kumo';
import { ArrowUpRightIcon, PackageIcon, XIcon } from '@phosphor-icons/react';
import type {
	StoreWorkspaceProduct,
	StoreWorkspaceProducts,
} from '@/api-types';
import { useAuth } from '@/contexts/auth-context';
import { useFlag } from '@/hooks/use-flag';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';
import { getLocale, t, tn, useI18n } from '@/lib/i18n';
import { formatCents } from '@/lib/pricing';
import { formatShortDateTime } from '@/lib/format-date';

import { BuilderHandoff } from './builder-handoff';

const money = (cents: number) => formatCents(cents, getLocale());

function priceRange(product: StoreWorkspaceProduct) {
	const prices = product.variants.map((variant) => variant.priceCents);
	const low = Math.min(...prices);
	const high = Math.max(...prices);
	return low === high ? money(low) : `${money(low)} – ${money(high)}`;
}

function ProductImage({
	product,
	large = false,
}: {
	product: StoreWorkspaceProduct;
	large?: boolean;
}) {
	const [failedUrl, setFailedUrl] = useState<string | null>(null);
	return (
		<span
			className={`${large ? 'h-48 w-full' : 'size-12 shrink-0'} flex items-center justify-center overflow-hidden rounded-xl border border-kumo-line bg-kumo-recessed`}
		>
			{product.imageUrl && failedUrl !== product.imageUrl ? (
				<img
					src={product.imageUrl}
					alt=""
					loading="lazy"
					referrerPolicy="no-referrer"
					className="size-full object-cover"
					onError={() => setFailedUrl(product.imageUrl)}
				/>
			) : (
				<PackageIcon
					size={large ? 48 : 24}
					className="text-kumo-subtle"
				/>
			)}
		</span>
	);
}

/** Products belong to the selected store and account; the builder remains the source of edits. */
export function StoreProductsPanel({ appId }: { appId: string }) {
	useI18n();
	const { user } = useAuth();
	const catalogPaused = useFlag('catalog-paused');
	const collection = useQuery({
		queryKey: queryKeys.account.storeProducts(appId, user?.id),
		queryFn: () =>
			unwrap(
				apiClient.getStoreProducts(appId),
				t("Couldn't load your products"),
			),
		enabled: Boolean(user && appId),
		retry: false,
	});
	const builderUrl = `/chat/${encodeURIComponent(appId)}`;
	return (
		<div className="grid gap-5">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="grid gap-1">
					<h2 className="text-lg font-semibold text-kumo-strong">
						{t('Published collection')}
					</h2>
					<p className="max-w-2xl text-sm text-kumo-subtle">
						{t(
							'Review your published products, then use the builder to add products or make changes.',
						)}{' '}
						<Link
							to={builderUrl}
							className="underline underline-offset-2"
						>
							{t('Open store builder')}
						</Link>
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					{!catalogPaused && (
						<Link
							to={`/catalog?store=${encodeURIComponent(appId)}`}
							className={buttonVariants({
								variant: 'secondary',
								size: 'sm',
							})}
						>
							{t('Explore the catalog')}
						</Link>
					)}
					<BuilderHandoff
						appId={appId}
						label={t('Add product')}
						request={t(
							'Help me add a product to this store. Ask me for its name, price, images, variants, and fulfillment details before making changes.',
						)}
					/>
				</div>
			</div>
			{collection.data ? (
				<Collection
					key={`${user?.id}:${appId}`}
					data={collection.data}
					builderUrl={builderUrl}
				/>
			) : collection.isError ? (
				<Empty
					title={t("Couldn't load your products")}
					description={collection.error.message}
					contents={
						<Button
							variant="secondary"
							size="sm"
							onClick={() => void collection.refetch()}
						>
							{t('Try again')}
						</Button>
					}
				/>
			) : (
				<div
					className="flex items-center justify-center gap-3 py-16 text-sm text-kumo-subtle"
					role="status"
				>
					<Loader />
					{t('Loading products…')}
				</div>
			)}
		</div>
	);
}

function Collection({
	data,
	builderUrl,
}: {
	data: StoreWorkspaceProducts;
	builderUrl: string;
}) {
	const [search, setSearch] = useState('');
	const [availability, setAvailability] = useState<
		'all' | 'listed' | 'unavailable'
	>('all');
	const [params, setParams] = useSearchParams();
	const selectedId = params.get('product');
	const setSelectedId = (id: string | null) => {
		const next = new URLSearchParams(params);
		if (id) next.set('product', id);
		else next.delete('product');
		setParams(next, { replace: true });
	};
	const selected = data.products.find((product) => product.id === selectedId);
	const filtered = data.products.filter((product) => {
		const listed = product.variants.some((variant) => variant.available);
		const matches =
			`${product.name} ${product.description ?? ''} ${product.variants.map((variant) => variant.name).join(' ')}`
				.toLowerCase()
				.includes(search.trim().toLowerCase());
		return (
			matches &&
			(availability === 'all' ||
				(availability === 'listed' ? listed : !listed))
		);
	});
	if (data.manifestStatus !== 'ready') {
		const title =
			data.manifestStatus === 'unpublished'
				? t('Publish your collection')
				: data.manifestStatus === 'missing'
					? t('Add your products in the builder')
					: t('Your collection needs attention');
		const description =
			data.manifestStatus === 'unpublished'
				? t(
						'Products appear here after you publish your store. Continue building your collection, then publish it when you are ready.',
					)
				: data.manifestStatus === 'missing'
					? t(
							'The published store does not have a connected product collection yet. Use the builder to set up your products and checkout.',
						)
					: t(
							'We could not read the published product collection. Open the builder to check your products and publish an updated version.',
						);
		return (
			<div className="rounded-xl border border-kumo-line bg-kumo-base p-6">
				<Empty
					title={title}
					description={description}
					contents={
						<Link
							to={builderUrl}
							className={buttonVariants({
								variant: 'secondary',
								size: 'sm',
							})}
						>
							{t('Open store builder')}
							<ArrowUpRightIcon size={14} />
						</Link>
					}
				/>
			</div>
		);
	}
	return (
		<>
			<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-kumo-line bg-kumo-base p-4 text-sm">
				<div className="flex flex-wrap items-center gap-3">
					<Badge
						variant={
							data.status === 'live' ? 'success' : 'secondary'
						}
					>
						{data.status === 'live'
							? t('Live collection')
							: t('Store offline')}
					</Badge>
					<span className="text-kumo-subtle">
						{data.publishedAt
							? t('Published {date}', {
									date: formatShortDateTime(
										new Date(data.publishedAt),
										getLocale(),
									),
								})
							: t('Last published version')}
					</span>
				</div>
				{data.storeUrl && (
					<a
						href={data.storeUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-1.5 font-medium text-kumo-default"
					>
						{t('Visit store')}
						<ArrowUpRightIcon size={14} />
					</a>
				)}
			</div>
			<div className="es-panel">
				<div className="flex flex-wrap items-center justify-between gap-3 border-b border-kumo-line p-4">
					<Input
						type="search"
						size="sm"
						aria-label={t('Search products')}
						placeholder={t('Search products or variants')}
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						className="w-full sm:max-w-xs"
					/>
					<div
						className="flex flex-wrap gap-1"
						role="group"
						aria-label={t('Product availability')}
					>
						{(['all', 'listed', 'unavailable'] as const).map(
							(value) => (
								<Button
									key={value}
									size="sm"
									variant={
										availability === value
											? 'secondary'
											: 'ghost'
									}
									aria-pressed={availability === value}
									onClick={() => setAvailability(value)}
								>
									{value === 'all'
										? t('All products')
										: value === 'listed'
											? t('Listed for sale')
											: t('Unavailable')}
								</Button>
							),
						)}
					</div>
				</div>
				<div className="es-table-scroll">
					<Table>
						<caption className="sr-only">
							{t('Products in the published collection')}
						</caption>
						<Table.Header>
							<Table.Row>
								<Table.Head>{t('Product')}</Table.Head>
								<Table.Head>{t('Variants')}</Table.Head>
								<Table.Head>{t('Price (USD)')}</Table.Head>
								<Table.Head>{t('Availability')}</Table.Head>
								<Table.Head>
									<span className="sr-only">
										{t('Actions')}
									</span>
								</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{filtered.map((product) => (
								<Table.Row key={product.id}>
									<Table.Cell>
										<button
											type="button"
											onClick={() =>
												setSelectedId(product.id)
											}
											className="flex min-w-52 items-center gap-3 py-2 text-left"
										>
											<ProductImage product={product} />
											<span className="grid gap-1">
												<span className="font-medium text-kumo-strong">
													{product.name}
												</span>
												{product.description && (
													<span className="line-clamp-1 max-w-xs text-xs text-kumo-subtle">
														{product.description}
													</span>
												)}
											</span>
										</button>
									</Table.Cell>
									<Table.Cell>
										{product.variants.length}
									</Table.Cell>
									<Table.Cell className="whitespace-nowrap font-medium">
										{priceRange(product)}
									</Table.Cell>
									<Table.Cell>
										<Badge
											variant={
												product.variants.some(
													(variant) =>
														variant.available,
												)
													? 'success'
													: 'secondary'
											}
										>
											{product.variants.some(
												(variant) => variant.available,
											)
												? t('Listed for sale')
												: t('Unavailable')}
										</Badge>
									</Table.Cell>
									<Table.Cell>
										<Button
											variant="ghost"
											size="sm"
											aria-label={t('View {product}', {
												product: product.name,
											})}
											onClick={() =>
												setSelectedId(product.id)
											}
										>
											{t('View details')}
										</Button>
									</Table.Cell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</div>
				{filtered.length === 0 && (
					<div className="p-8">
						<Empty
							title={t(
								'No products match your search or filter.',
							)}
						/>
					</div>
				)}
				<div className="border-t border-kumo-line px-4 py-3 text-xs text-kumo-subtle">
					{tn('{count} product', '{count} products', filtered.length)}
				</div>
			</div>
			<p className="text-xs leading-relaxed text-kumo-subtle">
				{t(
					'Availability reflects the published product settings. Supplier stock is checked at checkout. Changes in the builder appear here after publishing.',
				)}
			</p>
			<Dialog.Root
				open={Boolean(selected)}
				onOpenChange={(open) => {
					if (!open) setSelectedId(null);
				}}
			>
				{selected && (
					<Dialog
						size="xl"
						className="max-h-[85svh] overflow-auto p-6"
					>
						<div className="mb-4 flex items-start justify-between gap-3">
							<div>
								<Dialog.Title className="text-xl font-semibold text-kumo-strong">
									{selected.name}
								</Dialog.Title>
								<Dialog.Description className="mt-1 text-sm text-kumo-subtle">
									{t(
										'Product details from your last published collection.',
									)}
								</Dialog.Description>
							</div>
							<Dialog.Close
								render={(props) => (
									<Button
										{...props}
										variant="ghost"
										shape="square"
										aria-label={t('Close')}
									>
										<XIcon size={18} />
									</Button>
								)}
							/>
						</div>
						<ProductImage product={selected} large />
						{selected.description && (
							<p className="my-4 whitespace-pre-wrap text-sm leading-relaxed text-kumo-subtle">
								{selected.description}
							</p>
						)}
						<div className="my-5 overflow-x-auto rounded-lg border border-kumo-line">
							<Table>
								<Table.Header>
									<Table.Row>
										<Table.Head>{t('Variant')}</Table.Head>
										<Table.Head>{t('Source')}</Table.Head>
										<Table.Head>
											{t('Price (USD)')}
										</Table.Head>
										<Table.Head>
											{t('Availability')}
										</Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{selected.variants.map((variant) => (
										<Table.Row key={variant.id}>
											<Table.Cell>
												{variant.name}
											</Table.Cell>
											<Table.Cell>
												{variant.kind === 'catalog'
													? t('Estori catalog')
													: t('Your product')}
											</Table.Cell>
											<Table.Cell>
												{money(variant.priceCents)}
											</Table.Cell>
											<Table.Cell>
												{variant.available
													? t('Listed for sale')
													: t('Unavailable')}
											</Table.Cell>
										</Table.Row>
									))}
								</Table.Body>
							</Table>
						</div>
						<p className="text-xs text-kumo-subtle">
							{t(
								'Use the builder to change this product, then publish your updated store.',
							)}
						</p>
						<div className="mt-5 flex justify-end">
							<BuilderHandoff
								appId={data.appId}
								label={t('Edit in builder')}
								request={t(
									'Help me update "{name}" (product ID: {id}) in this store. Ask what I want to change, and preserve the other products.',
									{ name: selected.name, id: selected.id },
								)}
							/>
						</div>
					</Dialog>
				)}
			</Dialog.Root>
		</>
	);
}
