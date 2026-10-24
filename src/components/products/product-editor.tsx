import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Dialog, Input, Switch, Textarea } from '@cloudflare/kumo';
import {
	DeviceMobileIcon,
	DesktopIcon,
	PackageIcon,
	DownloadSimpleIcon,
	XIcon,
	PlusIcon,
	TrashIcon,
} from '@phosphor-icons/react';
import type {
	AccountProduct,
	AccountProductType,
	ProductAsset,
	ProductVisibility,
	SaveAccountProduct,
} from '@/api-types';
import { apiClient } from '@/lib/api-client';
import { t, useI18n, getLocale } from '@/lib/i18n';
import { formatCents } from '@/lib/pricing';
import { unwrap } from '@/lib/unwrap-response';
import { useRefreshProducts } from '@/hooks/use-private-products';
import { validateProductDraft } from './product-utils';
import './products.css';

type EditorVariant = {
	id: string;
	name: string;
	price: string;
	sku: string;
	available: boolean;
	catalogVariantId?: string;
};
export function ProductEditor({
	product,
	storeId,
	visibility = 'visible',
	onClose,
}: {
	product?: AccountProduct;
	storeId?: string;
	visibility?: ProductVisibility;
	onClose: () => void;
}) {
	useI18n();
	const [savedRevision, setSavedRevision] = useState(product?.revision);
	const [name, setName] = useState(product?.name ?? '');
	const [description, setDescription] = useState(product?.description ?? '');
	const [category, setCategory] = useState(product?.category ?? '');
	const [type, setType] = useState<AccountProductType>(
		product?.type ?? 'physical',
	);
	const [image, setImage] = useState<ProductAsset | null>(
		product?.image ?? null,
	);
	const [downloads, setDownloads] = useState(product?.downloads ?? []);
	const [weight, setWeight] = useState(String(product?.weightGrams ?? ''));
	const [visible, setVisible] = useState(visibility === 'visible');
	const [variants, setVariants] = useState<EditorVariant[]>(
		product?.variants.map((v) => ({
			...v,
			price: (v.priceCents / 100).toFixed(2),
		})) ?? [
			{ id: '', name: t('Default'), price: '', sku: '', available: true },
		],
	);
	const [mobile, setMobile] = useState(false);
	const [dirty, setDirty] = useState(false);
	const [discard, setDiscard] = useState(false);
	const [error, setError] = useState('');
	const refresh = useRefreshProducts();
	const change = (action: () => void) => {
		action();
		setDirty(true);
		setError('');
	};
	const upload = useMutation({
		mutationFn: async ({
			file,
			kind,
		}: {
			file: File;
			kind: 'image' | 'download';
		}) => {
			if (file.size > 20 * 1024 * 1024)
				throw new Error(t('Files must be smaller than 20 MB.'));
			return {
				asset: await unwrap(
					apiClient.uploadProductAsset(file, kind),
					t('Upload failed'),
				),
				kind,
			};
		},
		onSuccess: ({ asset, kind }) =>
			change(() =>
				kind === 'image'
					? setImage(asset)
					: setDownloads((current) => [...current, asset]),
			),
		onError: (e) => setError(e.message),
	});
	const save = useMutation({
		mutationFn: async () => {
			const invalid = validateProductDraft(
				name,
				variants.map((v) => v.price),
			);
			if (invalid) throw new Error(invalid);
			if (
				type === 'physical' &&
				weight &&
				(!Number.isFinite(Number(weight)) ||
					Number(weight) <= 0 ||
					!Number.isInteger(Number(weight)))
			)
				throw new Error(t('Enter a whole positive weight in grams.'));
			const body: SaveAccountProduct = {
				name: name.trim(),
				description,
				category,
				type,
				variants: variants.map(({ price, ...v }) => ({
					...v,
					priceCents: Math.round(Number(price) * 100),
				})),
				imageAssetId: image?.id || null,
				downloadAssetIds:
					type === 'digital' ? downloads.map((d) => d.id) : [],
				weightGrams:
					type === 'physical' && weight ? Number(weight) : null,
				...(product
					? { revision: savedRevision }
					: storeId
						? {
								storeId,
								visibility: visible ? 'visible' : 'hidden',
							}
						: {}),
			};
			const result = await unwrap(
				product
					? apiClient.updateAccountProduct(product.id, body)
					: apiClient.createAccountProduct(body),
				t("Couldn't save the product"),
			);
			setSavedRevision(result.revision);
			if (product && storeId && visible !== (visibility === 'visible'))
				await unwrap(
					apiClient.updateStoreProduct(storeId, product.id, {
						visibility: visible ? 'visible' : 'hidden',
					}),
					t("Couldn't update visibility"),
				);
			return result;
		},
		onSuccess: async () => {
			await refresh();
			onClose();
		},
		onError: (e) => setError(e.message),
	});
	const busy = save.isPending || upload.isPending;
	const close = () => {
		if (busy) return;
		if (dirty) setDiscard(true);
		else onClose();
	};
	useEffect(() => {
		if (typeof window === 'undefined') return;
		const handler = (e: BeforeUnloadEvent) => {
			if (dirty) e.preventDefault();
		};
		window.addEventListener('beforeunload', handler);
		return () => window.removeEventListener('beforeunload', handler);
	}, [dirty]);
	return (
		<Dialog.Root
			open
			onOpenChange={(open) => {
				if (!open) close();
			}}
		>
			<Dialog size="xl" className="product-editor-shell">
				<form
					onSubmit={(e) => {
						e.preventDefault();
						save.mutate();
					}}
				>
					<header className="product-editor-header">
						<div>
							<Dialog.Title className="text-lg font-semibold">
								{product
									? t('Edit product')
									: t('Create product')}
							</Dialog.Title>
							<Dialog.Description className="text-xs text-kumo-subtle">
								{t(
									'Saved privately in your account. Reuse it across your stores.',
								)}
							</Dialog.Description>
						</div>
						<div className="flex gap-2">
							<Button
								type="button"
								variant="secondary"
								disabled={busy}
								onClick={close}
							>
								{t('Close')}
							</Button>
							<Button
								type="submit"
								variant="primary"
								disabled={busy}
							>
								{save.isPending
									? t('Saving…')
									: t('Save product')}
							</Button>
						</div>
					</header>
					<div className="product-editor-grid">
						<div className="product-editor-fields">
							{error && (
								<p
									role="alert"
									className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
								>
									{error}
								</p>
							)}
							<section>
								<h3>{t('Details')}</h3>
								<div className="grid grid-cols-2 gap-3">
									{(['physical', 'digital'] as const).map(
										(value) => (
											<Button
												variant="secondary"
												key={value}
												type="button"
												className={`product-type-card ${type === value ? 'selected' : ''}`}
												aria-pressed={type === value}
												disabled={
													product?.source ===
													'catalog'
												}
												onClick={() =>
													change(() => setType(value))
												}
											>
												{value === 'physical' ? (
													<PackageIcon size={25} />
												) : (
													<DownloadSimpleIcon
														size={25}
													/>
												)}
												<strong>
													{value === 'physical'
														? t('Physical product')
														: t('Digital product')}
												</strong>
												<span>
													{value === 'physical'
														? t(
																'Ship a product to your customer',
															)
														: t(
																'Deliver private downloadable files',
															)}
												</span>
											</Button>
										),
									)}
								</div>
								<label className="product-field">
									{t('Product name')}
									<Input
										required
										maxLength={200}
										value={name}
										placeholder={t(
											'Give your product a name',
										)}
										onChange={(e) =>
											change(() =>
												setName(e.target.value),
											)
										}
									/>
								</label>
								<label className="product-field">
									{t('Description')}
									<Textarea
										rows={4}
										maxLength={5000}
										className="product-textarea"
										value={description}
										placeholder={t(
											'What makes this product special?',
										)}
										onChange={(e) =>
											change(() =>
												setDescription(e.target.value),
											)
										}
									/>
								</label>
								<label className="product-field">
									{t('Category')}
									<Input
										maxLength={100}
										value={category}
										onChange={(e) =>
											change(() =>
												setCategory(e.target.value),
											)
										}
									/>
								</label>
								<label className="product-field">
									{t('Cover image')}
									<Input
										type="file"
										accept="image/jpeg,image/png,image/webp,image/avif"
										disabled={busy}
										onChange={(e) => {
											const file = e.target.files?.[0];
											if (file)
												upload.mutate({
													file,
													kind: 'image',
												});
											e.target.value = '';
										}}
									/>
								</label>
								{image && (
									<div className="flex items-center gap-3 text-sm">
										<img
											src={image.url}
											alt=""
											className="size-16 rounded-lg object-cover"
										/>
										<span className="truncate">
											{image.name}
										</span>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onClick={() =>
												change(() => setImage(null))
											}
										>
											{t('Remove')}
										</Button>
									</div>
								)}
							</section>
							<section>
								<div className="flex items-center justify-between">
									<h3>{t('Pricing')}</h3>
									<span className="text-xs text-kumo-subtle">
										{t('One-time payment · USD')}
									</span>
								</div>
								<p className="text-sm text-kumo-subtle">
									{t(
										'Set your price for each variant. Minimum $0.50.',
									)}
								</p>
								{variants.map((variant, index) => (
									<div
										key={variant.id || `new-${index}`}
										className="product-variant"
									>
										<div className="grid grid-cols-2 gap-3">
											<label className="product-field">
												{t('Variant name')}
												<Input
													required
													maxLength={120}
													value={variant.name}
													onChange={(e) =>
														change(() =>
															setVariants(
																(current) =>
																	current.map(
																		(
																			v,
																			i,
																		) =>
																			i ===
																			index
																				? {
																						...v,
																						name: e
																							.target
																							.value,
																					}
																				: v,
																	),
															),
														)
													}
												/>
											</label>
											<label className="product-field">
												{t('Price (USD)')}
												<Input
													required
													type="number"
													min="0.50"
													max="10000"
													step="0.01"
													value={variant.price}
													onChange={(e) =>
														change(() =>
															setVariants(
																(current) =>
																	current.map(
																		(
																			v,
																			i,
																		) =>
																			i ===
																			index
																				? {
																						...v,
																						price: e
																							.target
																							.value,
																					}
																				: v,
																	),
															),
														)
													}
												/>
											</label>
										</div>
										<div className="flex items-end gap-3">
											<label className="product-field grow">
												{t('SKU')}
												<Input
													maxLength={100}
													value={variant.sku}
													onChange={(e) =>
														change(() =>
															setVariants(
																(current) =>
																	current.map(
																		(
																			v,
																			i,
																		) =>
																			i ===
																			index
																				? {
																						...v,
																						sku: e
																							.target
																							.value,
																					}
																				: v,
																	),
															),
														)
													}
												/>
											</label>
											<Switch
												aria-label={t(
													'Available for sale',
												)}
												checked={variant.available}
												onCheckedChange={(checked) =>
													change(() =>
														setVariants((current) =>
															current.map(
																(v, i) =>
																	i === index
																		? {
																				...v,
																				available:
																					checked,
																			}
																		: v,
															),
														),
													)
												}
											/>
											<Button
												type="button"
												variant="ghost"
												aria-label={t('Remove variant')}
												disabled={
													variants.length === 1 ||
													product?.source ===
														'catalog'
												}
												onClick={() =>
													change(() =>
														setVariants((current) =>
															current.filter(
																(_, i) =>
																	i !== index,
															),
														),
													)
												}
											>
												<TrashIcon />
											</Button>
										</div>
									</div>
								))}
								<Button
									type="button"
									variant="secondary"
									size="sm"
									disabled={
										variants.length >= 30 ||
										product?.source === 'catalog'
									}
									onClick={() =>
										change(() =>
											setVariants((current) => [
												...current,
												{
													id: '',
													name: '',
													price: '',
													sku: '',
													available: true,
												},
											]),
										)
									}
								>
									<PlusIcon />
									{t('Add variant')}
								</Button>
							</section>
							<section>
								<h3>{t('Fulfillment')}</h3>
								{type === 'physical' ? (
									<label className="product-field">
										{t('Weight (grams)')}
										<Input
											type="number"
											min="1"
											step="1"
											value={weight}
											onChange={(e) =>
												change(() =>
													setWeight(e.target.value),
												)
											}
										/>
									</label>
								) : (
									<>
										<p className="text-sm text-kumo-subtle">
											{t(
												'Files stay private and are available to customers after payment.',
											)}
										</p>
										<label className="product-field">
											{t('Digital files')}
											<Input
												type="file"
												accept=".pdf,.txt,.epub,.mp3,.m4a,.wav,.ogg,.mp4,.webm"
												disabled={busy}
												onChange={(e) => {
													const file =
														e.target.files?.[0];
													if (file)
														upload.mutate({
															file,
															kind: 'download',
														});
													e.target.value = '';
												}}
											/>
										</label>
										{downloads.map((file) => (
											<div
												key={file.id}
												className="flex items-center justify-between gap-3 py-2 text-sm"
											>
												<span className="truncate">
													{file.name}
												</span>
												<Button
													type="button"
													variant="ghost"
													size="sm"
													aria-label={t(
														'Remove {name}',
														{ name: file.name },
													)}
													onClick={() =>
														change(() =>
															setDownloads(
																(current) =>
																	current.filter(
																		(d) =>
																			d.id !==
																			file.id,
																	),
															),
														)
													}
												>
													<XIcon />
												</Button>
											</div>
										))}
									</>
								)}
								{upload.isPending && (
									<p role="status">{t('Uploading…')}</p>
								)}
							</section>
							{storeId && (
								<section className="flex justify-between gap-4">
									<div>
										<h3>{t('Visibility')}</h3>
										<p className="text-sm text-kumo-subtle">
											{t(
												'Visible products appear in the next published store version.',
											)}
										</p>
									</div>
									<Switch
										checked={visible}
										aria-label={t('Visible in store')}
										onCheckedChange={(checked) =>
											change(() => setVisible(checked))
										}
									/>
								</section>
							)}
						</div>
						<aside className="product-preview">
							<div className="mb-5 flex items-center justify-between">
								<span className="text-sm font-medium">
									{t('Live preview')}
								</span>
								<div className="flex gap-1">
									<Button
										type="button"
										variant={mobile ? 'ghost' : 'secondary'}
										size="sm"
										aria-label={t('Desktop preview')}
										onClick={() => setMobile(false)}
									>
										<DesktopIcon />
									</Button>
									<Button
										type="button"
										variant={mobile ? 'secondary' : 'ghost'}
										size="sm"
										aria-label={t('Mobile preview')}
										onClick={() => setMobile(true)}
									>
										<DeviceMobileIcon />
									</Button>
								</div>
							</div>
							<div
								className={`product-preview-card ${mobile ? 'mobile' : ''}`}
							>
								<div className="product-preview-image">
									{image ? (
										<img src={image.url} alt="" />
									) : (
										<PackageIcon size={58} weight="light" />
									)}
								</div>
								<div className="p-6">
									<p className="mb-2 text-xs text-kumo-subtle">
										{category || t('Your product')}
									</p>
									<h3 className="text-xl font-semibold">
										{name || t('Product name')}
									</h3>
									<p className="mt-2 whitespace-pre-wrap text-sm text-kumo-subtle">
										{description ||
											t(
												'Your description will appear here.',
											)}
									</p>
									<p className="mt-6 text-xl font-semibold">
										{formatCents(
											Math.round(
												Number(
													variants[0]?.price || 0,
												) * 100,
											),
											getLocale(),
										)}
									</p>
									<div className="mt-4 rounded-lg bg-blue-600 px-4 py-3 text-center text-sm font-medium text-white">
										{t('Buy now')}
									</div>
								</div>
							</div>
							<p className="mt-4 text-center text-xs text-kumo-subtle">
								{t(
									'Preview only. Save and publish your store to make changes live.',
								)}
							</p>
						</aside>
					</div>
				</form>
				{discard && (
					<div
						className="product-discard"
						role="alertdialog"
						aria-label={t('Discard changes?')}
					>
						<strong>{t('Discard changes?')}</strong>
						<p>{t('Your unsaved changes will be lost.')}</p>
						<div className="mt-4 flex gap-2">
							<Button
								type="button"
								variant="secondary"
								onClick={() => setDiscard(false)}
							>
								{t('Keep editing')}
							</Button>
							<Button
								type="button"
								variant="primary"
								onClick={onClose}
							>
								{t('Discard changes')}
							</Button>
						</div>
					</div>
				)}
			</Dialog>
		</Dialog.Root>
	);
}
