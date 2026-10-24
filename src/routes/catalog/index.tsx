import { formatUsd } from '@/api-types';
import { getLocale, t, useI18n } from '@/lib/i18n';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
	Button,
	Empty,
	Input,
	LayerCard,
	Loader,
	Select,
} from '@cloudflare/kumo';
import { pageTitle } from '@/brand';
import type { CatalogProductView, CatalogVariantView } from '@/api-types';
import { useCatalogProducts } from '@/hooks/use-catalog';
import { useApps } from '@/hooks/use-apps';
import { useAuth } from '@/contexts/auth-context';
import { MyProducts } from '@/components/products/my-products';
import { useMutation } from '@tanstack/react-query';
import { useRefreshProducts } from '@/hooks/use-private-products';
import { apiClient } from '@/lib/api-client';
import { unwrap } from '@/lib/unwrap-response';
import './catalog.css';
import { useFlag } from '@/hooks/use-flag';

function money(cents: number | null): string {
	return cents === null ? t('Unavailable') : formatUsd(cents, getLocale());
}

/** A new build that sells this product: the store agent finds it in the catalog by name. */
function startPath(product: CatalogProductView): string {
	const variant = product.variants.find((candidate) => candidate.available);
	const price = variant?.suggestedRetailPriceCents
		? t(' at {price}', { price: money(variant.suggestedRetailPriceCents) })
		: '';
	const params = new URLSearchParams({
		query: t(
			'Build a store that sells the "{value1}" from the Estori catalog{value2}.',
			{ value1: product.title, value2: price },
		),
		projectType: 'app',
		behaviorType: 'think',
	});
	return `/chat/new?${params.toString()}`;
}

function VariantRow({ variant }: { variant: CatalogVariantView }) {
	return (
		<tr className="border-t border-kumo-line">
			<td className="py-2 pr-4">{variant.name}</td>
			<td className="py-2 pr-4">{money(variant.catalogPriceCents)}</td>
			<td className="py-2 pr-4">
				{money(variant.minimumRetailPriceCents)}
			</td>
			<td className="py-2">{money(variant.suggestedRetailPriceCents)}</td>
		</tr>
	);
}

function ProductCard({
	product,
	storeId,
	storeUnavailable,
}: {
	product: CatalogProductView;
	storeId: string | null;
	storeUnavailable: boolean;
}) {
	useI18n();
	const navigate = useNavigate();
	const refresh = useRefreshProducts();
	const add = useMutation({
		mutationFn: () =>
			unwrap(
				apiClient.addStoreProduct(storeId!, {
					catalogProductId: product.productId,
				}),
				t("Couldn't add the product"),
			),
		onSuccess: refresh,
	});
	const sellable = product.variants.some((variant) => variant.available);
	return (
		<LayerCard>
			<LayerCard.Primary>
				<div className="grid gap-4 sm:grid-cols-[160px_1fr]">
					{product.imageUrls[0] ? (
						<img
							src={product.imageUrls[0]}
							alt={product.title}
							className="aspect-square w-full rounded-lg object-cover"
							loading="lazy"
						/>
					) : (
						<div
							className="aspect-square w-full rounded-lg bg-kumo-tint"
							aria-hidden="true"
						/>
					)}
					<div className="grid gap-3">
						<div>
							<p className="text-sm text-kumo-subtle">
								{product.category}
							</p>
							<h2 className="text-lg font-semibold text-kumo-strong">
								{product.title}
							</h2>
							<p className="mt-1 line-clamp-3 text-sm text-kumo-subtle">
								{product.description}
							</p>
						</div>
						<div className="overflow-x-auto">
							<table className="w-full text-left text-sm">
								<caption className="sr-only">
									{t(
										'Variants of {product}, with your cost and prices for US delivery',
										{ product: product.title },
									)}
								</caption>
								<thead className="text-kumo-subtle">
									<tr>
										<th
											scope="col"
											className="py-1 pr-4 font-normal"
										>
											{t('Variant')}
										</th>
										<th
											scope="col"
											className="py-1 pr-4 font-normal"
										>
											{t('Your cost')}
										</th>
										<th
											scope="col"
											className="py-1 pr-4 font-normal"
										>
											{t('Lowest price')}
										</th>
										<th
											scope="col"
											className="py-1 font-normal"
										>
											{t('Suggested price')}
										</th>
									</tr>
								</thead>
								<tbody>
									{product.variants.map((variant) => (
										<VariantRow
											key={variant.catalogVariantId}
											variant={variant}
										/>
									))}
								</tbody>
							</table>
						</div>
						<div className="flex flex-wrap items-center gap-3">
							{storeId && sellable ? (
								<div>
									<Button
										variant="primary"
										size="sm"
										disabled={
											add.isPending || add.isSuccess
										}
										onClick={() => add.mutate()}
									>
										{add.isSuccess
											? t('Added to store')
											: t('Add to this store')}
									</Button>
									{add.error && (
										<p
											role="alert"
											className="mt-2 text-sm text-red-600"
										>
											{add.error.message}
										</p>
									)}
								</div>
							) : (
								<Button
									variant="primary"
									size="sm"
									disabled={!sellable || storeUnavailable}
									onClick={() => navigate(startPath(product))}
								>
									{t('Start a store with this')}
								</Button>
							)}
							<p className="text-xs text-kumo-subtle">
								{t(
									'Ships to the US. Your cost includes delivery.',
								)}
							</p>
						</div>
					</div>
				</div>
			</LayerCard.Primary>
		</LayerCard>
	);
}

export default function CatalogPage() {
	useI18n();
	const [query, setQuery] = useState('');

	const [params, setParams] = useSearchParams();
	const [tab, setTab] = useState<'mine' | 'estori'>(() =>
		params.get('tab') === 'estori' ? 'estori' : 'mine',
	);
	const { user } = useAuth();
	const stores = useApps();
	const requestedStore = params.get('store');
	const ownedStores = stores.apps.filter(
		(store) => store.userId === user?.id,
	);
	const selectedStore = ownedStores.find(
		(store) => store.id === requestedStore,
	);
	const storeUnavailable = Boolean(requestedStore && !selectedStore);
	const products = useCatalogProducts(query);
	const catalogPaused = useFlag('catalog-paused');
	return (
		<div className="size-full catalog-page">
			<title>{pageTitle('Catalog')}</title>
			<div className="container mx-auto grid max-w-6xl gap-6 px-4 py-8">
				<div className="grid gap-1">
					<h1 className="text-3xl font-semibold text-kumo-strong">
						{t('Catalog')}
					</h1>
					<p className="text-kumo-subtle">
						{t(
							'Manage your private products and discover products from the Estori catalog.',
						)}
					</p>
				</div>
				<div className="catalog-context flex flex-wrap items-center justify-between gap-3">
					<Select
						aria-label={t('Store for catalog products')}
						value={requestedStore ?? ''}
						onValueChange={(value) => {
							const next = new URLSearchParams(params);
							if (value) next.set('store', value);
							else next.delete('store');
							setParams(next);
						}}
						items={{
							'': t('Create a new store'),
							...(requestedStore && !selectedStore
								? {
										[requestedStore]: stores.loading
											? t('Loading store…')
											: t('Store unavailable'),
									}
								: {}),
							...Object.fromEntries(
								ownedStores.map((store) => [
									store.id,
									store.title || t('Untitled store'),
								]),
							),
						}}
					/>
					{selectedStore && (
						<Link
							className="text-sm underline underline-offset-2"
							to={`/stores/${encodeURIComponent(selectedStore.id)}?section=products`}
						>
							{t('Back to store products')}
						</Link>
					)}
					{storeUnavailable && (
						<p role="status" className="text-sm text-kumo-subtle">
							{stores.loading
								? t('Loading store…')
								: t('Choose one of your stores to continue.')}
						</p>
					)}
				</div>
				<div className="flex gap-2 border-b border-kumo-line pb-3">
					<Button
						variant={tab === 'mine' ? 'secondary' : 'ghost'}
						aria-pressed={tab === 'mine'}
						onClick={() => setTab('mine')}
					>
						{t('My products')}
					</Button>
					<Button
						variant={tab === 'estori' ? 'secondary' : 'ghost'}
						aria-pressed={tab === 'estori'}
						onClick={() => setTab('estori')}
					>
						{t('Estori catalog')}
					</Button>
				</div>
				{tab === 'mine' ? (
					<MyProducts
						key={selectedStore?.id ?? 'account'}
						storeId={selectedStore?.id}
					/>
				) : catalogPaused ? (
					<Empty
						title={t('The catalog is paused')}
						description={t(
							"Catalog products can't be added to stores or bought right now. Orders already paid for still ship.",
						)}
					/>
				) : (
					<>
						<Input
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={t('Search the catalog')}
							aria-label={t('Search the catalog')}
							className="w-full rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-sm"
						/>
						{products.data ? (
							products.data.products.length === 0 ? (
								<Empty
									title={t('Nothing matches')}
									description={t('Try another word.')}
								/>
							) : (
								<div className="catalog-results grid gap-4">
									{products.data.products.map((product) => (
										<ProductCard
											key={`${selectedStore?.id ?? 'account'}:${product.productId}`}
											product={product}
											storeId={selectedStore?.id ?? null}
											storeUnavailable={storeUnavailable}
										/>
									))}
								</div>
							)
						) : products.isLoading ? (
							<div className="flex justify-center py-16">
								<Loader />
							</div>
						) : (
							<Empty
								title={t("Couldn't load the catalog")}
								description={products.error?.message}
								contents={
									<Button
										size="sm"
										onClick={() => void products.refetch()}
									>
										{t('Try again')}
									</Button>
								}
							/>
						)}
					</>
				)}
			</div>
		</div>
	);
}
