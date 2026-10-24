import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Dialog, Input, Loader } from '@cloudflare/kumo';
import { PackageIcon, XIcon } from '@phosphor-icons/react';
import {
	usePrivateProducts,
	useRefreshProducts,
	useStoreProductCollection,
} from '@/hooks/use-private-products';
import { useCatalogProducts } from '@/hooks/use-catalog';
import { useFlag } from '@/hooks/use-flag';
import { apiClient } from '@/lib/api-client';
import { unwrap } from '@/lib/unwrap-response';
import { t, getLocale } from '@/lib/i18n';
import { formatCents } from '@/lib/pricing';
export function CatalogPicker({
	storeId,
	onClose,
}: {
	storeId: string;
	onClose: () => void;
}) {
	const [tab, setTab] = useState<'mine' | 'estori'>('mine');
	const [search, setSearch] = useState('');
	const mine = usePrivateProducts();
	const collection = useStoreProductCollection(storeId);
	const attachedProducts = new Set(
		collection.data?.products.map((listing) => listing.product.id) ?? [],
	);
	const attachedCatalogProducts = new Set(
		collection.data?.products.flatMap((listing) =>
			listing.product.sourceCatalogProductId
				? [listing.product.sourceCatalogProductId]
				: [],
		) ?? [],
	);
	const catalog = useCatalogProducts(search);
	const paused = useFlag('catalog-paused');
	const refresh = useRefreshProducts();
	const add = useMutation({
		mutationFn: (body: { productId?: string; catalogProductId?: string }) =>
			unwrap(
				apiClient.addStoreProduct(storeId, body),
				t("Couldn't add the product"),
			),
		onSuccess: async () => {
			await refresh();
			onClose();
		},
	});
	const options =
		tab === 'mine'
			? (mine.data?.products ?? [])
					.filter(
						(p) =>
							!p.archived &&
							`${p.name} ${p.category}`
								.toLowerCase()
								.includes(search.toLowerCase()),
					)
					.map((p) => ({
						id: p.id,
						name: p.name,
						image: p.image?.url,
						type:
							p.type === 'digital' ? t('Digital') : t('Physical'),
						price: Math.min(...p.variants.map((v) => v.priceCents)),
						disabled: false,
						attached: attachedProducts.has(p.id),
					}))
			: (catalog.data?.products ?? []).map((p) => ({
					id: p.productId,
					name: p.title,
					image: p.imageUrls[0],
					type: t('Physical'),
					price: Math.min(
						...p.variants.map(
							(v) =>
								v.suggestedRetailPriceCents ??
								v.minimumRetailPriceCents ??
								0,
						),
					),
					disabled: !p.variants.some((v) => v.available),
					attached: attachedCatalogProducts.has(p.productId),
				}));
	const source = tab === 'mine' ? mine : catalog;
	return (
		<Dialog.Root
			open
			onOpenChange={(open) => {
				if (!open && !add.isPending) onClose();
			}}
		>
			<Dialog size="lg" className="max-h-[85svh] overflow-auto p-6">
				<div className="flex justify-between gap-4">
					<div>
						<Dialog.Title className="text-xl font-semibold">
							{t('Add from catalog')}
						</Dialog.Title>
						<Dialog.Description className="mt-1 text-sm text-kumo-subtle">
							{t(
								'Reuse a private product or import a product from Estori.',
							)}
						</Dialog.Description>
					</div>
					<Button
						variant="ghost"
						aria-label={t('Close')}
						onClick={onClose}
					>
						<XIcon />
					</Button>
				</div>
				<div className="my-5 flex gap-2">
					{(['mine', 'estori'] as const).map((value) => (
						<Button
							key={value}
							variant={tab === value ? 'secondary' : 'ghost'}
							aria-pressed={tab === value}
							onClick={() => setTab(value)}
						>
							{value === 'mine'
								? t('My products')
								: t('Estori catalog')}
						</Button>
					))}
				</div>
				<Input
					type="search"
					className="w-full"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					placeholder={t('Search products')}
					aria-label={t('Search products')}
				/>
				{collection.isError && (
					<p role="alert" className="my-3 text-sm text-red-600">
						{collection.error.message}
					</p>
				)}
				{add.error && (
					<p role="alert" className="my-3 text-sm text-red-600">
						{add.error.message}
					</p>
				)}
				{tab === 'estori' && paused ? (
					<p className="py-8 text-sm">{t('The catalog is paused')}</p>
				) : source.isLoading ? (
					<div className="py-10">
						<Loader />
					</div>
				) : source.isError ? (
					<p role="alert" className="py-8">
						{source.error.message}
					</p>
				) : (
					<div className="mt-4 grid gap-1">
						{options.map((p) => (
							<div
								key={p.id}
								className="flex items-center gap-3 border-b border-kumo-line py-3"
							>
								<span className="product-thumb">
									{p.image ? (
										<img
											src={p.image}
											alt=""
											className="size-full rounded-md object-cover"
										/>
									) : (
										<PackageIcon />
									)}
								</span>
								<div className="min-w-0 grow">
									<p className="truncate text-sm font-medium">
										{p.name}
									</p>
									<p className="text-xs text-kumo-subtle">
										{p.type} ·{' '}
										{formatCents(p.price, getLocale())}
									</p>
								</div>
								<Button
									size="sm"
									variant="secondary"
									disabled={
										p.disabled ||
										p.attached ||
										add.isPending ||
										collection.isPending ||
										collection.isError
									}
									onClick={() =>
										add.mutate(
											tab === 'mine'
												? { productId: p.id }
												: { catalogProductId: p.id },
										)
									}
								>
									{p.attached
										? t('Added to store')
										: t('Add to store')}
								</Button>
							</div>
						))}
						{!options.length && (
							<p className="py-10 text-center text-sm text-kumo-subtle">
								{t('No products found.')}
							</p>
						)}
					</div>
				)}
			</Dialog>
		</Dialog.Root>
	);
}
