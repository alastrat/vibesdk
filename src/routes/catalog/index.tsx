import { formatUsd } from '@/api-types';
import { getLocale, t, useI18n } from '@/lib/i18n';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Empty, LayerCard, Loader } from '@cloudflare/kumo';
import { pageTitle } from '@/brand';
import type { CatalogProductView, CatalogVariantView } from '@/api-types';
import { useCatalogProducts } from '@/hooks/use-catalog';
import { useFlag } from '@/hooks/use-flag';

function money(cents: number | null): string {
	return cents === null ? t('Unavailable') : formatUsd(cents, getLocale());
}

/** A new build that sells this product: the store agent finds it in the catalog by name. */
function startPath(product: CatalogProductView): string {
	const variant = product.variants.find((candidate) => candidate.available);
	const price = variant?.suggestedRetailPriceCents ? t(' at {price}', { price: money(variant.suggestedRetailPriceCents) }) : '';
	const params = new URLSearchParams({
		query: t("Build a store that sells the \"{value1}\" from the Estori catalog{value2}.", { value1: product.title, value2: price }),
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
			<td className="py-2 pr-4">{money(variant.minimumRetailPriceCents)}</td>
			<td className="py-2">{money(variant.suggestedRetailPriceCents)}</td>
		</tr>
	);
}

function ProductCard({ product }: { product: CatalogProductView }) {
	useI18n();
	const navigate = useNavigate();
	const sellable = product.variants.some((variant) => variant.available);
	return (
		<LayerCard>
			<LayerCard.Primary>
				<div className="grid gap-4 sm:grid-cols-[160px_1fr]">
					{product.imageUrls[0] ? (
						<img src={product.imageUrls[0]} alt={product.title} className="aspect-square w-full rounded-lg object-cover" loading="lazy" />
					) : (
						<div className="aspect-square w-full rounded-lg bg-kumo-tint" aria-hidden="true" />
					)}
					<div className="grid gap-3">
						<div>
							<p className="text-sm text-kumo-subtle">{product.category}</p>
							<h2 className="text-lg font-semibold text-kumo-strong">{product.title}</h2>
							<p className="mt-1 line-clamp-3 text-sm text-kumo-subtle">{product.description}</p>
						</div>
						<div className="overflow-x-auto">
							<table className="w-full text-left text-sm">
								<caption className="sr-only">{t('Variants of {product}, with your cost and prices for US delivery', { product: product.title })}</caption>
								<thead className="text-kumo-subtle">
									<tr>
										<th scope="col" className="py-1 pr-4 font-normal">{t("Variant")}</th>
										<th scope="col" className="py-1 pr-4 font-normal">{t("Your cost")}</th>
										<th scope="col" className="py-1 pr-4 font-normal">{t("Lowest price")}</th>
										<th scope="col" className="py-1 font-normal">{t("Suggested price")}</th>
									</tr>
								</thead>
								<tbody>
									{product.variants.map((variant) => (
										<VariantRow key={variant.catalogVariantId} variant={variant} />
									))}
								</tbody>
							</table>
						</div>
						<div className="flex flex-wrap items-center gap-3">
							<Button variant="primary" disabled={!sellable} onClick={() => navigate(startPath(product), { state: { fromPrompt: true } })}>{t("Start a store with this")}</Button>
							<p className="text-xs text-kumo-subtle">{t("Ships to the US. Your cost includes delivery.")}</p>
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
	const products = useCatalogProducts(query);
	const catalogPaused = useFlag('catalog-paused');
	return (
		<div className="size-full">
			<title>{pageTitle('Catalog')}</title>
			<div className="container mx-auto grid max-w-5xl gap-6 px-4 py-8">
				<div className="grid gap-1">
					<h1 className="text-3xl font-semibold text-kumo-strong">{t("Catalog")}</h1>
					<p className="text-kumo-subtle">{t("Products you can sell without holding stock. We ship each order straight to your shopper in plain packaging, and take your cost from the sale.")}</p>
				</div>
				{catalogPaused ? (
					<Empty
						title={t("The catalog is paused")}
						description={t("Catalog products can't be added to stores or bought right now. Orders already paid for still ship.")}
					/>
				) : (
					<>
						<input
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={t("Search the catalog")}
							aria-label={t("Search the catalog")}
							className="w-full rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-sm"
						/>
						{products.data ? (
							products.data.products.length === 0 ? (
								<Empty title={t("Nothing matches")} description={t("Try another word.")} />
							) : (
								<div className="grid gap-4">
									{products.data.products.map((product) => (
										<ProductCard key={product.productId} product={product} />
									))}
								</div>
							)
						) : products.isLoading ? (
							<div className="flex justify-center py-16">
								<Loader />
							</div>
						) : (
							<Empty title={t("Couldn't load the catalog")} description={products.error?.message} />
						)}
					</>
				)}
			</div>
		</div>
	);
}
