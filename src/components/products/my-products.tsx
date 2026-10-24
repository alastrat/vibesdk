import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Input, Loader, Table } from '@cloudflare/kumo';
import { PackageIcon, PlusIcon } from '@phosphor-icons/react';
import type { AccountProduct } from '@/api-types';
import {
	usePrivateProducts,
	useRefreshProducts,
} from '@/hooks/use-private-products';
import { ProductEditor } from './product-editor';
import { apiClient } from '@/lib/api-client';
import { unwrap } from '@/lib/unwrap-response';
import { t, getLocale } from '@/lib/i18n';
import { formatCents } from '@/lib/pricing';
export function MyProducts({ storeId }: { storeId?: string }) {
	const products = usePrivateProducts();
	const refresh = useRefreshProducts();
	const [search, setSearch] = useState('');
	const [editor, setEditor] = useState<AccountProduct | 'new' | null>(null);
	const [added, setAdded] = useState<string[]>([]);
	const attach = useMutation({
		mutationFn: (productId: string) =>
			unwrap(
				apiClient.addStoreProduct(storeId!, { productId }),
				t("Couldn't add the product"),
			),
		onSuccess: async (_, id) => {
			setAdded((current) => [...current, id]);
			await refresh();
		},
	});
	const filtered = (products.data?.products ?? []).filter(
		(p) =>
			!p.archived &&
			`${p.name} ${p.category}`
				.toLowerCase()
				.includes(search.toLowerCase()),
	);
	return (
		<div className="grid gap-5">
			<div className="flex flex-wrap justify-between gap-3">
				<div>
					<h2 className="text-xl font-semibold">
						{t('My products')}
					</h2>
					<p className="mt-1 text-sm text-kumo-subtle">
						{t(
							'Your private catalog. Create once and reuse across your stores.',
						)}
					</p>
				</div>
				<Button variant="primary" onClick={() => setEditor('new')}>
					<PlusIcon />
					{t('Create product')}
				</Button>
			</div>
			<Input
				type="search"
				aria-label={t('Search my products')}
				placeholder={t('Search my products')}
				value={search}
				onChange={(e) => setSearch(e.target.value)}
			/>
			{attach.error && <p role="alert">{attach.error.message}</p>}
			{products.isLoading ? (
				<Loader />
			) : products.isError ? (
				<div role="alert">
					<p>{products.error.message}</p>
					<Button onClick={() => void products.refetch()}>
						{t('Try again')}
					</Button>
				</div>
			) : (
				<div className="overflow-x-auto">
					<Table className="private-products-table">
						<Table.Header>
							<Table.Row>
								<Table.Head>{t('Name')}</Table.Head>
								<Table.Head>{t('Price')}</Table.Head>
								<Table.Head>{t('Type')}</Table.Head>
								<Table.Head>{t('Actions')}</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{filtered.map((p) => (
								<Table.Row key={p.id}>
									<Table.Cell>
										<button
											className="flex items-center gap-3 font-medium"
											onClick={() => setEditor(p)}
										>
											<span className="product-thumb">
												{p.image ? (
													<img
														src={p.image.url}
														alt=""
														className="size-full rounded-md object-cover"
													/>
												) : (
													<PackageIcon />
												)}
											</span>
											{p.name}
										</button>
									</Table.Cell>
									<Table.Cell>
										{formatCents(
											Math.min(
												...p.variants.map(
													(v) => v.priceCents,
												),
											),
											getLocale(),
										)}
									</Table.Cell>
									<Table.Cell>
										{p.type === 'digital'
											? t('Digital')
											: t('Physical')}
									</Table.Cell>
									<Table.Cell>
										<div className="flex gap-2">
											<Button
												size="sm"
												variant="ghost"
												onClick={() => setEditor(p)}
											>
												{t('Edit')}
											</Button>
											{storeId && (
												<Button
													size="sm"
													variant="secondary"
													disabled={
														attach.isPending ||
														added.includes(p.id)
													}
													onClick={() =>
														attach.mutate(p.id)
													}
												>
													{added.includes(p.id)
														? t('Added to store')
														: t('Add to store')}
												</Button>
											)}
										</div>
									</Table.Cell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
					{!filtered.length && (
						<div className="py-14 text-center">
							<PackageIcon
								size={32}
								className="mx-auto mb-3 text-kumo-subtle"
							/>
							<p className="font-medium">
								{t('No products found.')}
							</p>
							<p className="mt-1 text-sm text-kumo-subtle">
								{t(
									'Create your first product to start your private catalog.',
								)}
							</p>
						</div>
					)}
				</div>
			)}
			{editor && (
				<ProductEditor
					key={editor === 'new' ? 'new' : editor.id}
					product={editor === 'new' ? undefined : editor}
					storeId={editor === 'new' ? storeId : undefined}
					onClose={() => setEditor(null)}
				/>
			)}
		</div>
	);
}
