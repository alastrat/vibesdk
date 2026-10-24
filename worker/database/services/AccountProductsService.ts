import { storeHostConfig } from '../../services/live-stores/hosts';
import { devPortOf, storeUrl } from '../../services/live-stores/view';
import { msg } from '../../../shared/i18n/translate';
import {
	minimumRetailPriceCents,
	suggestedRetailPriceCents,
} from '../../../shared/types/catalog';
import { CATALOG_OFFER_MAX_AGE_MS } from '../../services/catalog/config';
import { catalogImagePath } from '../../services/catalog/images';
import { loadAccount } from '../../services/billing/account';
import { assertWithinLimit } from '../../services/i18n/plan-limits';
import { isFlagOn } from '../../services/posthog/flags';
import { and, eq, sql, desc, or, inArray, isNotNull } from 'drizzle-orm';
import type {
	AccountProduct,
	AccountProductList,
	AddStoreProduct,
	ProductVisibility,
	SaveAccountProduct,
	StoreProductCollection,
	StoreProductListing,
} from '../../../shared/types/account-products';
import type { StoreManifestProduct } from '../../../shared/types/store-payments';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { ProductAssetService } from '../../services/account-products/assets';
import {
	ProductError,
	revisionOf,
	validateProduct,
	visibilityOf,
} from '../../services/account-products/validation';
import { parseStoreManifest } from '../../services/store-payments/manifest';

type ProductRow = typeof schema.accountProducts.$inferSelect;
interface ManifestSpace {
	getStoreManifest(
		branch: string,
	): Promise<{ commitHash: string; manifest: string | null } | null>;
}
export class AccountProductsService extends BaseService {
	async assertStoreOwner(ownerId: string, appId: string): Promise<void> {
		const app = await this.database
			.select({ ownerId: schema.apps.userId })
			.from(schema.apps)
			.where(eq(schema.apps.id, appId))
			.get();
		if (!app || app.ownerId !== ownerId)
			throw new ProductError(
				msg('You can only manage your own store'),
				403,
			);
	}
	private async row(ownerId: string, id: string): Promise<ProductRow> {
		const row = await this.database
			.select()
			.from(schema.accountProducts)
			.where(
				and(
					eq(schema.accountProducts.id, id),
					eq(schema.accountProducts.ownerId, ownerId),
				),
			)
			.get();
		if (!row) throw new ProductError(msg('Product not found'), 404);
		return row;
	}
	private async view(row: ProductRow): Promise<AccountProduct> {
		const assets = new ProductAssetService(this.env);
		const image = row.imageAssetId
			? await assets.getOwned(row.ownerId, row.imageAssetId)
			: null;
		const fallbackImage = row.sourceCatalogProductId
			? await this.catalogImageUrl(row.sourceCatalogProductId)
			: (row.legacyImageUrl ?? undefined);
		const downloads = await Promise.all(
			row.downloadAssetIds.map((id) => assets.getOwned(row.ownerId, id)),
		);
		return {
			id: row.id,
			name: row.name,
			description: row.description,
			category: row.category,
			type: row.type,
			source: row.source,
			sourceCatalogProductId: row.sourceCatalogProductId,
			variants: row.variants,
			image:
				image?.asset ??
				(fallbackImage
					? {
							id: '',
							kind: 'image',
							url: fallbackImage,
							name: row.name,
							contentType: 'image/jpeg',
							size: 0,
						}
					: null),
			downloads: downloads.flatMap((v) => (v ? [v.asset] : [])),
			weightGrams: row.weightGrams,
			archived: row.archived,
			revision: row.revision,
			createdAt: row.createdAt.toISOString(),
			updatedAt: row.updatedAt.toISOString(),
		};
	}
	async list(ownerId: string): Promise<AccountProductList> {
		const rows = await this.database
			.select()
			.from(schema.accountProducts)
			.where(eq(schema.accountProducts.ownerId, ownerId))
			.orderBy(desc(schema.accountProducts.createdAt))
			.all();
		return {
			products: await Promise.all(rows.map((row) => this.view(row))),
		};
	}
	async get(ownerId: string, id: string): Promise<AccountProduct> {
		return this.view(await this.row(ownerId, id));
	}
	private async validateAssets(
		ownerId: string,
		input: SaveAccountProduct,
	): Promise<void> {
		const assets = new ProductAssetService(this.env);
		if (input.imageAssetId) {
			const image = await assets.getOwned(ownerId, input.imageAssetId);
			if (!image || image.asset.kind !== 'image')
				throw new ProductError(
					msg('Image must belong to your account'),
				);
		}
		for (const id of input.downloadAssetIds) {
			const file = await assets.getOwned(ownerId, id);
			if (!file || file.asset.kind !== 'download')
				throw new ProductError(
					msg('Download must belong to your account'),
				);
		}
	}
	private fields(input: SaveAccountProduct) {
		return {
			name: input.name,
			description: input.description,
			category: input.category,
			type: input.type,
			variants: input.variants,
			imageAssetId: input.imageAssetId,
			downloadAssetIds: input.downloadAssetIds,
			weightGrams: input.weightGrams,
		};
	}
	async create(ownerId: string, raw: unknown): Promise<AccountProduct> {
		const input = validateProduct(raw);
		await this.validateAssets(ownerId, input);
		if (input.storeId) await this.assertStoreOwner(ownerId, input.storeId);
		const now = new Date();
		const row: ProductRow = {
			id: crypto.randomUUID(),
			ownerId,
			source: 'own',
			sourceCatalogProductId: null,
			legacyImageUrl: null,
			...this.fields(input),
			archived: false,
			revision: 1,
			createdAt: now,
			updatedAt: now,
		};
		const insert = this.database.insert(schema.accountProducts).values(row);
		if (input.storeId) {
			await this.database.batch([
				insert,
				this.database.insert(schema.storeProductListings).values({
					id: crypto.randomUUID(),
					appId: input.storeId,
					productId: row.id,
					visibility: input.visibility ?? 'visible',
					detached: false,
					createdAt: now,
					updatedAt: now,
				}),
			]);
		} else await insert;
		return this.view(row);
	}
	async update(
		ownerId: string,
		id: string,
		raw: unknown,
	): Promise<AccountProduct> {
		const row = await this.row(ownerId, id);
		const input = validateProduct(
			raw,
			row.variants,
			row.source === 'catalog',
		);
		const revision = revisionOf(input.revision);
		if (revision !== row.revision)
			throw new ProductError(
				msg('Product changed; reload and try again'),
				409,
			);
		await this.validateAssets(ownerId, input);
		if (input.storeId)
			throw new ProductError(
				msg('Attach products through the store collection'),
			);
		if (row.source === 'catalog')
			await this.validateCatalogPrices(row, input);
		const [updated] = await this.database
			.update(schema.accountProducts)
			.set({
				...this.fields(input),
				revision: revision + 1,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(schema.accountProducts.id, id),
					eq(schema.accountProducts.ownerId, ownerId),
					eq(schema.accountProducts.revision, revision),
				),
			)
			.returning();
		if (!updated)
			throw new ProductError(
				msg('Product changed; reload and try again'),
				409,
			);
		return this.view(updated);
	}
	async archive(
		ownerId: string,
		id: string,
		archived: boolean,
		revision: number,
	): Promise<AccountProduct> {
		if (typeof archived !== 'boolean')
			throw new ProductError(msg('Invalid archived flag'));
		revisionOf(revision);
		await this.row(ownerId, id);
		const [row] = await this.database
			.update(schema.accountProducts)
			.set({ archived, revision: revision + 1, updatedAt: new Date() })
			.where(
				and(
					eq(schema.accountProducts.id, id),
					eq(schema.accountProducts.ownerId, ownerId),
					eq(schema.accountProducts.revision, revision),
				),
			)
			.returning();
		if (!row)
			throw new ProductError(
				msg('Product changed; reload and try again'),
				409,
			);
		return this.view(row);
	}
	private async assertCatalogAccess(ownerId: string): Promise<void> {
		if (await isFlagOn(this.env, 'catalog-paused', ownerId))
			throw new ProductError(
				msg('Catalog imports are temporarily paused'),
				409,
			);
		const account = await loadAccount(this.env, ownerId);
		const refusal = assertWithinLimit(account, 'supplierCatalog');
		if (refusal)
			throw new ProductError(
				msg('Catalog access is disabled for your account'),
				403,
			);
	}
	private async catalogVariants(productId: string) {
		const product = await this.database
			.select()
			.from(schema.catalogProducts)
			.where(eq(schema.catalogProducts.id, productId))
			.get();
		if (!product || product.status !== 'active')
			throw new ProductError(msg('Catalog product is unavailable'));
		const variants = await this.database
			.select({
				variant: schema.catalogVariants,
				offer: schema.catalogVariantOffers,
			})
			.from(schema.catalogVariants)
			.innerJoin(
				schema.catalogVariantOffers,
				and(
					eq(
						schema.catalogVariants.id,
						schema.catalogVariantOffers.variantId,
					),
					eq(schema.catalogVariantOffers.destinationCountry, 'US'),
				),
			)
			.where(
				and(
					eq(schema.catalogVariants.productId, productId),
					eq(schema.catalogVariants.status, 'active'),
					eq(schema.catalogVariantOffers.available, true),
				),
			)
			.all();
		return {
			product,
			variants: variants.filter(
				(v) =>
					v.offer.catalogPriceCents !== null &&
					minimumRetailPriceCents(v.offer.catalogPriceCents) <=
						1000000 &&
					Date.now() - v.offer.updatedAt.getTime() <=
						CATALOG_OFFER_MAX_AGE_MS,
			),
		};
	}
	private async validateCatalogPrices(
		row: ProductRow,
		input: SaveAccountProduct,
	): Promise<void> {
		if (!row.sourceCatalogProductId)
			throw new ProductError(msg('Invalid catalog product'));
		const { variants } = await this.catalogVariants(
			row.sourceCatalogProductId,
		);
		for (const variant of input.variants) {
			const actual = variants.find(
				(v) => v.variant.id === variant.catalogVariantId,
			);
			if (
				!actual ||
				actual.offer.catalogPriceCents === null ||
				variant.priceCents <
					minimumRetailPriceCents(actual.offer.catalogPriceCents)
			)
				throw new ProductError(
					msg(
						'Catalog variant unavailable or price below catalog floor',
					),
				);
		}
	}
	private async stableId(parts: readonly string[]): Promise<string> {
		const digest = await crypto.subtle.digest(
			'SHA-256',
			new TextEncoder().encode(JSON.stringify(parts)),
		);
		return (
			'p-' +
			Array.from(new Uint8Array(digest))
				.map((v) => v.toString(16).padStart(2, '0'))
				.join('')
				.slice(0, 60)
		);
	}
	private async importCatalog(
		ownerId: string,
		catalogProductId: string,
	): Promise<ProductRow> {
		const existing = await this.database
			.select()
			.from(schema.accountProducts)
			.where(
				and(
					eq(schema.accountProducts.ownerId, ownerId),
					eq(
						schema.accountProducts.sourceCatalogProductId,
						catalogProductId,
					),
				),
			)
			.get();
		if (existing) return existing;
		await this.assertCatalogAccess(ownerId);
		const { product, variants } =
			await this.catalogVariants(catalogProductId);
		if (!variants.length || variants.length > 30)
			throw new ProductError(
				msg('Catalog product must have 1 to 30 available variants'),
			);
		const now = new Date();
		await this.database
			.insert(schema.accountProducts)
			.values({
				id: await this.stableId([ownerId, 'catalog', catalogProductId]),
				ownerId,
				source: 'catalog',
				sourceCatalogProductId: catalogProductId,
				type: 'physical',
				name: (product.title ?? 'Catalog product').slice(0, 200),
				description: (product.description ?? '').slice(0, 5000),
				category: product.category.slice(0, 100),
				variants: variants.map(({ variant, offer }) => ({
					id: crypto.randomUUID(),
					catalogVariantId: variant.id,
					name: variant.name.slice(0, 200),
					priceCents: Math.min(
						1000000,
						Math.max(
							50,
							suggestedRetailPriceCents(
								offer.catalogPriceCents ?? 50,
							),
						),
					),
					sku: variant.sku ?? '',
					available: true,
				})),
				imageAssetId: null,
				downloadAssetIds: [],
				weightGrams: variants[0].variant.weightGrams,
				archived: false,
				revision: 1,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing();
		const imported = await this.database
			.select()
			.from(schema.accountProducts)
			.where(
				and(
					eq(schema.accountProducts.ownerId, ownerId),
					eq(
						schema.accountProducts.sourceCatalogProductId,
						catalogProductId,
					),
				),
			)
			.get();
		if (!imported)
			throw new ProductError(msg('Could not import product'), 409);
		return imported;
	}
	async attach(
		ownerId: string,
		appId: string,
		input: AddStoreProduct,
	): Promise<StoreProductListing> {
		await this.assertStoreOwner(ownerId, appId);
		if (
			!input ||
			typeof input !== 'object' ||
			[
				input.productId,
				input.catalogProductId,
				input.publishedProductId,
			].filter(Boolean).length !== 1
		)
			throw new ProductError(
				msg('Choose one private or catalog product'),
			);
		if (
			(input.productId !== undefined &&
				typeof input.productId !== 'string') ||
			(input.catalogProductId !== undefined &&
				typeof input.catalogProductId !== 'string')
		)
			throw new ProductError(msg('Invalid product ID'));
		if (input.publishedProductId)
			return this.adoptPublished(
				ownerId,
				appId,
				input.publishedProductId,
				input.visibility,
			);
		const product = input.catalogProductId
			? await this.importCatalog(ownerId, input.catalogProductId)
			: await this.row(ownerId, input.productId ?? '');
		if (product.archived)
			throw new ProductError(
				msg('Restore this product before adding it to a store'),
			);
		if (product.source === 'catalog')
			await this.validateCatalogPrices(product, this.fields(product));
		const now = new Date();
		const visibility =
			input.visibility === undefined
				? 'visible'
				: visibilityOf(input.visibility);
		const prior = await this.database
			.select()
			.from(schema.storeProductListings)
			.where(
				and(
					eq(schema.storeProductListings.appId, appId),
					eq(schema.storeProductListings.productId, product.id),
				),
			)
			.get();
		// Repeat adds preserve the current visibility; an explicit PATCH changes it.
		await this.database
			.insert(schema.storeProductListings)
			.values({
				id: crypto.randomUUID(),
				appId,
				productId: product.id,
				visibility,
				detached: false,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: [
					schema.storeProductListings.appId,
					schema.storeProductListings.productId,
				],
				set: {
					detached: false,
					...(prior?.detached ? { visibility } : {}),
					updatedAt: now,
				},
			});
		const collection = await this.collection(ownerId, appId, 'test');
		const listing = collection.products.find(
			(v) => v.product.id === product.id,
		);
		if (!listing)
			throw new ProductError(msg('Could not attach product'), 409);
		return listing;
	}
	async setVisibility(
		ownerId: string,
		appId: string,
		productId: string,
		visibility: ProductVisibility,
	): Promise<StoreProductListing> {
		await this.assertStoreOwner(ownerId, appId);
		await this.row(ownerId, productId);
		visibilityOf(visibility);
		const [row] = await this.database
			.update(schema.storeProductListings)
			.set({ visibility, updatedAt: new Date() })
			.where(
				and(
					eq(schema.storeProductListings.appId, appId),
					eq(schema.storeProductListings.productId, productId),
					eq(schema.storeProductListings.detached, false),
				),
			)
			.returning();
		if (!row) throw new ProductError(msg('Listing not found'), 404);
		const listing = (
			await this.collection(ownerId, appId, 'test')
		).products.find((p) => p.product.id === productId);
		if (!listing) throw new ProductError(msg('Listing not found'), 404);
		return listing;
	}
	async detach(
		ownerId: string,
		appId: string,
		productId: string,
	): Promise<void> {
		await this.assertStoreOwner(ownerId, appId);
		await this.row(ownerId, productId);
		await this.database
			.update(schema.storeProductListings)
			.set({ detached: true, updatedAt: new Date() })
			.where(
				and(
					eq(schema.storeProductListings.appId, appId),
					eq(schema.storeProductListings.productId, productId),
				),
			);
	}
	private async listings(ownerId: string, appId: string) {
		await this.assertStoreOwner(ownerId, appId);
		return this.database
			.select({
				listing: schema.storeProductListings,
				product: schema.accountProducts,
			})
			.from(schema.storeProductListings)
			.innerJoin(
				schema.accountProducts,
				and(
					eq(
						schema.storeProductListings.productId,
						schema.accountProducts.id,
					),
					eq(schema.accountProducts.ownerId, ownerId),
				),
			)
			.where(eq(schema.storeProductListings.appId, appId))
			.all();
	}
	private async publishedImageUrl(
		appId: string,
		image: string | undefined,
	): Promise<string | undefined> {
		if (!image || /^https?:\/\//.test(image)) return image;
		if (image.startsWith('/api/catalog/images/'))
			return this.platformUrl(image);
		const config = storeHostConfig(this.env);
		if (!config.storesDomain) return image;
		const record = await this.database
			.select({ slug: schema.liveStores.slug })
			.from(schema.liveStores)
			.where(eq(schema.liveStores.appId, appId))
			.get();
		return record
			? new URL(
					image,
					storeUrl(
						`${record.slug}.${config.storesDomain}`,
						devPortOf(this.env.CUSTOM_DOMAIN),
					),
				).href
			: image;
	}
	private platformUrl(path: string): string {
		const configured = this.env.CUSTOM_DOMAIN || 'localhost:5173';
		const origin = /^https?:\/\//.test(configured)
			? configured
			: `${configured.startsWith('localhost') ? 'http' : 'https'}://${configured}`;
		return new URL(path, origin).href;
	}
	private async catalogImageUrl(
		productId: string,
	): Promise<string | undefined> {
		const row = await this.database
			.select({ images: schema.catalogProducts.images })
			.from(schema.catalogProducts)
			.where(eq(schema.catalogProducts.id, productId))
			.get();
		try {
			const images: unknown = JSON.parse(row?.images ?? '[]');
			if (
				Array.isArray(images) &&
				typeof images[0] === 'string' &&
				images[0].startsWith(`catalog/${productId}/`)
			)
				return this.platformUrl(catalogImagePath(images[0]));
		} catch {
			/* Invalid stored image list. */
		}
		return undefined;
	}
	private async manifestProduct(
		row: ProductRow,
	): Promise<StoreManifestProduct> {
		let image: string | undefined = row.imageAssetId
			? `/__estori/product-images/${row.id}/${row.imageAssetId}`
			: (row.legacyImageUrl ?? undefined);
		if (!image && row.sourceCatalogProductId)
			image = await this.catalogImageUrl(row.sourceCatalogProductId);
		return {
			id: row.id,
			accountProductId: row.id,
			type: row.type,
			name: row.name,
			...(row.description ? { description: row.description } : {}),
			...(image ? { image } : {}),
			...(row.type === 'digital'
				? { downloadAssetIds: row.downloadAssetIds }
				: {}),
			variants: row.variants.map((v) => ({
				id: v.id,
				name: v.name,
				priceCents: v.priceCents,
				available: v.available,
				...(v.catalogVariantId
					? { catalogVariantId: v.catalogVariantId }
					: {}),
			})),
		};
	}
	async projectStore(
		ownerId: string,
		appId: string,
	): Promise<{
		managedProductIds: string[];
		adoptedProductIds: string[];
		products: StoreManifestProduct[];
	}> {
		const rows = await this.listings(ownerId, appId);
		return {
			managedProductIds: rows.flatMap((v) => [
				v.product.id,
				...(v.listing.originalManifestProductId
					? [v.listing.originalManifestProductId]
					: []),
			]),
			adoptedProductIds: rows.flatMap((v) =>
				v.listing.originalManifestProductId
					? [v.listing.originalManifestProductId]
					: [],
			),
			products: await Promise.all(
				rows
					.filter(
						(v) =>
							!v.listing.detached &&
							!v.product.archived &&
							v.listing.visibility === 'visible',
					)
					.map((v) => this.manifestProduct(v.product)),
			),
		};
	}
	private comparable(product: StoreManifestProduct | undefined): string {
		if (!product) return '';
		return JSON.stringify({
			id: product.id,
			name: product.name,
			description: product.description ?? '',
			image: product.image ?? '',
			type: product.type ?? 'physical',
			accountProductId: product.accountProductId ?? '',
			downloadAssetIds: product.downloadAssetIds ?? [],
			variants: product.variants.map((v) => ({
				id: v.id,
				name: v.name,
				priceCents: v.priceCents,
				available: v.available !== false,
				catalogVariantId: v.catalogVariantId ?? '',
			})),
		});
	}
	private async adoptPublished(
		ownerId: string,
		appId: string,
		originalId: string,
		requestedVisibility: unknown,
	): Promise<StoreProductListing> {
		if (typeof originalId !== 'string')
			throw new ProductError(msg('Invalid published product'));
		const prior = await this.database
			.select({ productId: schema.storeProductListings.productId })
			.from(schema.storeProductListings)
			.where(
				and(
					eq(schema.storeProductListings.appId, appId),
					eq(
						schema.storeProductListings.originalManifestProductId,
						originalId,
					),
				),
			)
			.get();
		if (prior)
			return this.attach(ownerId, appId, { productId: prior.productId });
		const published = await this.published(appId);
		const original = published.find(
			(v) => v.id === originalId && !v.accountProductId,
		);
		if (!original)
			throw new ProductError(msg('Published product not found'), 404);
		if (original.variants.length > 30)
			throw new ProductError(
				msg('Published product exceeds 30 variants'),
			);
		const catalogIds = original.variants.flatMap((v) =>
			v.catalogVariantId ? [v.catalogVariantId] : [],
		);
		if (catalogIds.length && catalogIds.length !== original.variants.length)
			throw new ProductError(
				msg('Mixed own/catalog variants cannot be imported'),
			);
		let sourceCatalogProductId: string | null = null;
		if (catalogIds.length) {
			await this.assertCatalogAccess(ownerId);
			for (const variant of original.variants) {
				const catalog = await this.database
					.select({ productId: schema.catalogVariants.productId })
					.from(schema.catalogVariants)
					.where(
						eq(
							schema.catalogVariants.id,
							variant.catalogVariantId ?? '',
						),
					)
					.get();
				if (
					!catalog ||
					(sourceCatalogProductId &&
						sourceCatalogProductId !== catalog.productId)
				)
					throw new ProductError(msg('Invalid catalog product'));
				sourceCatalogProductId = catalog.productId;
			}
		}
		const now = new Date();
		const digest = await crypto.subtle.digest(
			'SHA-256',
			new TextEncoder().encode(
				JSON.stringify([ownerId, appId, originalId]),
			),
		);
		const id =
			'p-' +
			Array.from(new Uint8Array(digest))
				.map((v) => v.toString(16).padStart(2, '0'))
				.join('')
				.slice(0, 60);
		const row: ProductRow = {
			id,
			ownerId,
			source: catalogIds.length ? 'catalog' : 'own',
			sourceCatalogProductId,
			type: original.type ?? 'physical',
			name: original.name,
			description: original.description ?? '',
			category: '',
			variants: original.variants.map((v) => ({
				...v,
				id: crypto.randomUUID(),
				sku: '',
				available: v.available !== false,
			})),
			legacyImageUrl:
				(await this.publishedImageUrl(appId, original.image)) ?? null,
			imageAssetId: null,
			downloadAssetIds: original.downloadAssetIds ?? [],
			weightGrams: null,
			archived: false,
			revision: 1,
			createdAt: now,
			updatedAt: now,
		};
		await this.validateAssets(ownerId, this.fields(row));
		if (row.source === 'catalog')
			await this.validateCatalogPrices(row, this.fields(row));
		const target = id;
		await this.database.batch([
			this.database
				.insert(schema.accountProducts)
				.values(row)
				.onConflictDoNothing(),
			this.database
				.insert(schema.storeProductListings)
				.values({
					id: crypto.randomUUID(),
					appId,
					productId: target,
					originalManifestProductId: originalId,
					visibility:
						requestedVisibility === undefined
							? 'visible'
							: visibilityOf(requestedVisibility),
					detached: false,
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: [
						schema.storeProductListings.appId,
						schema.storeProductListings.productId,
					],
					set: {
						originalManifestProductId: originalId,
						detached: false,
						updatedAt: now,
					},
				}),
		]);
		const listing = (await this.collection(ownerId, appId)).products.find(
			(v) => v.product.id === target,
		);
		if (!listing)
			throw new ProductError(
				msg('Could not import published product'),
				409,
			);
		return listing;
	}
	private async published(appId: string): Promise<StoreManifestProduct[]> {
		const record = await this.database
			.select({ publishedCommit: schema.liveStores.publishedCommit })
			.from(schema.liveStores)
			.where(eq(schema.liveStores.appId, appId))
			.get();
		if (!record || !this.env.SPACE_DO) return [];
		const space = this.env.SPACE_DO.get(
			this.env.SPACE_DO.idFromName(appId),
		) as unknown as ManifestSpace;
		const snapshot = await space.getStoreManifest('live');
		if (
			!snapshot ||
			snapshot.commitHash !== record.publishedCommit ||
			!snapshot.manifest
		)
			throw new ProductError(
				msg('Published products are temporarily unavailable'),
				409,
			);
		const parsed = parseStoreManifest(snapshot.manifest);
		if (!parsed.ok)
			throw new ProductError(
				msg('Published product manifest is invalid'),
				409,
			);
		return parsed.manifest.products;
	}
	async collection(
		ownerId: string,
		appId: string,
		mode: 'test' | 'live' = 'test',
	): Promise<StoreProductCollection> {
		if (mode !== 'test' && mode !== 'live')
			throw new ProductError(msg('Invalid order mode'));
		const rows = await this.listings(ownerId, appId);
		const published = await this.published(appId);
		const metrics = await this.database
			.select({
				productId: sql<string>`coalesce(${schema.storeProductListings.productId}, ${schema.storeOrderItems.productId})`,
				revenueCents: sql<number>`sum(case when ${schema.storeOrders.paymentStatus} = 'refunded' then 0 else max(0, ${schema.storeOrderItems.quantity} * ${schema.storeOrderItems.unitPriceCents} - coalesce(${schema.storeRefunds.amountCents}, 0)) end)`,
				orders: sql<number>`count(distinct ${schema.storeOrders.id})`,
				customers: sql<number>`count(distinct lower(${schema.storeOrders.customerEmail}))`,
				unitsSold: sql<number>`sum(${schema.storeOrderItems.quantity})`,
			})
			.from(schema.storeOrderItems)
			.innerJoin(
				schema.storeOrders,
				eq(schema.storeOrderItems.orderId, schema.storeOrders.id),
			)
			.leftJoin(
				schema.storeProductListings,
				and(
					eq(schema.storeProductListings.appId, appId),
					or(
						eq(
							schema.storeProductListings.productId,
							schema.storeOrderItems.productId,
						),
						eq(
							schema.storeProductListings
								.originalManifestProductId,
							schema.storeOrderItems.productId,
						),
					),
				),
			)
			.leftJoin(
				schema.storeRefunds,
				and(
					eq(
						schema.storeRefunds.orderId,
						schema.storeOrderItems.orderId,
					),
					eq(
						schema.storeRefunds.lineNo,
						schema.storeOrderItems.lineNo,
					),
					isNotNull(schema.storeRefunds.stripeRefundId),
				),
			)
			.where(
				and(
					eq(schema.storeOrders.appId, appId),
					eq(schema.storeOrders.sellerUserId, ownerId),
					eq(schema.storeOrders.mode, mode),
					inArray(schema.storeOrders.paymentStatus, [
						'paid',
						'partially_refunded',
						'refunded',
					]),
				),
			)
			.groupBy(
				sql`coalesce(${schema.storeProductListings.productId}, ${schema.storeOrderItems.productId})`,
			)
			.all();
		const products: StoreProductListing[] = [];
		let hasUnpublishedChanges = false;
		for (const { listing, product } of rows) {
			const current = await this.manifestProduct(product);
			const live = published.find((p) => p.id === product.id);
			// Adoption replaces the original immutable product only at the next publish.
			const originalLive = listing.originalManifestProductId
				? published.find((p) => p.id === listing.originalManifestProductId)
				: undefined;
			const visible =
				!listing.detached &&
				!product.archived &&
				listing.visibility === 'visible';
			const pendingChanges = visible
				? !!originalLive || this.comparable(live) !== this.comparable(current)
				: !!live || !!originalLive;
			hasUnpublishedChanges ||= pendingChanges;
			if (listing.detached) continue;
			const metric = metrics.find((v) => v.productId === product.id);
			products.push({
				id: listing.id,
				product: await this.view(product),
				visibility: listing.visibility,
				published: !!live || !!originalLive,
				pendingChanges,
				revenueCents: Number(metric?.revenueCents ?? 0),
				orders: Number(metric?.orders ?? 0),
				customers: Number(metric?.customers ?? 0),
				unitsSold: Number(metric?.unitsSold ?? 0),
			});
		}
		const managed = new Set(
			rows.flatMap((v) => [
				v.product.id,
				...(v.listing.originalManifestProductId
					? [v.listing.originalManifestProductId]
					: []),
			]),
		);
		for (const legacy of published.filter((p) => !managed.has(p.id))) {
			const metric = metrics.find((v) => v.productId === legacy.id);
			products.push({
				id: `published:${legacy.id}`,
				product: {
					id: legacy.id,
					name: legacy.name,
					description: legacy.description ?? '',
					category: '',
					type: legacy.type ?? 'physical',
					source: legacy.variants.some((v) => v.catalogVariantId)
						? 'catalog'
						: 'own',
					sourceCatalogProductId: null,
					variants: legacy.variants.map((v) => ({
						...v,
						sku: '',
						available: v.available !== false,
					})),
					image: legacy.image
						? {
								id: '',
								url:
									(await this.publishedImageUrl(
										appId,
										legacy.image,
									)) ?? legacy.image,
								name: legacy.name,
								contentType: 'image/jpeg',
								kind: 'image',
								size: 0,
							}
						: null,
					downloads: [],
					weightGrams: null,
					archived: false,
					revision: 1,
					createdAt: '',
					updatedAt: '',
				},
				visibility: 'visible',
				published: true,
				pendingChanges: false,
				revenueCents: Number(metric?.revenueCents ?? 0),
				orders: Number(metric?.orders ?? 0),
				customers: Number(metric?.customers ?? 0),
				unitsSold: Number(metric?.unitsSold ?? 0),
			});
		}
		return { appId, currency: 'usd', products, hasUnpublishedChanges };
	}
}
