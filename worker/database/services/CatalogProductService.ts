/** D1 reads and writes for catalog products, variants and offers. */

import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { generateId } from '../../utils/idGenerator';
import { CATALOG_DETAILS_MAX_AGE_MS, CATALOG_REFRESH_CLAIM_MS } from '../../services/catalog/config';
import type { CatalogRefreshStore, ClaimedProduct, CuratedProduct, OfferLookup, RefreshedProduct } from '../../services/catalog/catalog-store';

function imageKeysOf(images: string): string[] {
    const parsed: unknown = JSON.parse(images);
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [];
}

export class CatalogProductService extends BaseService implements CatalogRefreshStore {
    /**
     * Adds curated products not yet in the catalog, pauses or reactivates listed ones, and retires the rest. The curated
     * category and title are the authority; a title the list leaves out keeps the supplier's.
     */
    async ensureCurated(entries: readonly CuratedProduct[], now: Date): Promise<void> {
        const listed = new Set(entries.map((entry) => entry.supplierProductId));
        const existing = await this.database
            .select({ id: schema.catalogProducts.id, supplierProductId: schema.catalogProducts.supplierProductId })
            .from(schema.catalogProducts)
            .all();
        // One statement per product: D1 binds at most 100 parameters per statement.
        const retire = existing
            .filter((product) => !listed.has(product.supplierProductId))
            .map((product) => this.database.update(schema.catalogProducts).set({ status: 'retired', updatedAt: now }).where(eq(schema.catalogProducts.id, product.id)));
        const statements = entries.map((entry) =>
            this.database
                .insert(schema.catalogProducts)
                .values({
                    id: generateId(),
                    supplier: 'cjdropshipping',
                    supplierProductId: entry.supplierProductId,
                    status: entry.paused ? 'paused' : 'active',
                    category: entry.category,
                    title: entry.title ?? null,
                    createdAt: now,
                    updatedAt: now,
                })
                .onConflictDoUpdate({
                    target: [schema.catalogProducts.supplier, schema.catalogProducts.supplierProductId],
                    set: { status: entry.paused ? 'paused' : 'active', category: entry.category, ...(entry.title ? { title: entry.title } : {}), updatedAt: now },
                }),
        );
        const [first, ...rest] = [...retire, ...statements];
        if (!first) return;
        await this.database.batch([first, ...rest]);
    }

    /** Claims the stalest products due for a refresh, so overlapping runs never refresh the same one. */
    async claimForRefresh(limit: number, now: Date): Promise<ClaimedProduct[]> {
        const due = this.database
            .select({ id: schema.catalogProducts.id })
            .from(schema.catalogProducts)
            .where(
                and(
                    inArray(schema.catalogProducts.status, ['active', 'paused']),
                    or(isNull(schema.catalogProducts.refreshClaimedUntil), lt(schema.catalogProducts.refreshClaimedUntil, now)),
                    or(isNull(schema.catalogProducts.detailsRefreshedAt), lt(schema.catalogProducts.detailsRefreshedAt, new Date(now.getTime() - CATALOG_DETAILS_MAX_AGE_MS))),
                ),
            )
            .orderBy(asc(sql`coalesce(${schema.catalogProducts.detailsRefreshedAt}, 0)`))
            .limit(limit);
        const rows = await this.database
            .update(schema.catalogProducts)
            .set({ refreshClaimedUntil: new Date(now.getTime() + CATALOG_REFRESH_CLAIM_MS) })
            .where(inArray(schema.catalogProducts.id, due))
            .returning({
                id: schema.catalogProducts.id,
                supplierProductId: schema.catalogProducts.supplierProductId,
                status: schema.catalogProducts.status,
                title: schema.catalogProducts.title,
                images: schema.catalogProducts.images,
            });
        return rows.map(({ images, ...row }) => ({ ...row, imageKeys: imageKeysOf(images) }));
    }

    /** One batch per product: the product, each variant and each offer in its own statement (D1 binds at most 100 parameters). */
    async saveRefresh(product: RefreshedProduct): Promise<void> {
        const at = product.refreshedAt;
        const existing = await this.database
            .select({ id: schema.catalogVariants.id, supplierVariantId: schema.catalogVariants.supplierVariantId })
            .from(schema.catalogVariants)
            .where(eq(schema.catalogVariants.productId, product.productId))
            .all();
        const variantIds = new Map(existing.map((variant) => [variant.supplierVariantId, variant.id]));
        for (const variant of product.variants) if (!variantIds.has(variant.supplierVariantId)) variantIds.set(variant.supplierVariantId, generateId());
        const listed = new Set(product.variants.map((variant) => variant.supplierVariantId));

        const updateProduct = this.database
            .update(schema.catalogProducts)
            .set({
                title: product.title,
                description: product.description,
                images: JSON.stringify(product.imageKeys),
                attributes: JSON.stringify(product.attributes),
                detailsRefreshedAt: at,
                refreshClaimedUntil: null,
                lastRefreshError: null,
                updatedAt: at,
            })
            .where(eq(schema.catalogProducts.id, product.productId));
        const variants = product.variants.map((variant) => {
            const row = {
                sku: variant.sku,
                name: variant.name,
                options: JSON.stringify(variant.options),
                imageKey: variant.imageKey,
                weightGrams: variant.weightGrams,
                supplierCostCents: variant.supplierCostCents,
                stock: JSON.stringify(variant.stock),
                status: variant.status,
                updatedAt: at,
            };
            return this.database
                .insert(schema.catalogVariants)
                .values({ ...row, id: variantIds.get(variant.supplierVariantId) ?? generateId(), productId: product.productId, supplierVariantId: variant.supplierVariantId })
                .onConflictDoUpdate({ target: schema.catalogVariants.supplierVariantId, set: row });
        });
        const offers = product.offers.flatMap((offer) => {
            const variantId = variantIds.get(offer.supplierVariantId);
            if (!variantId) return [];
            const row = {
                originCountry: offer.originCountry,
                logisticName: offer.logisticName,
                deliveryDaysMin: offer.deliveryDaysMin,
                deliveryDaysMax: offer.deliveryDaysMax,
                supplierCostCents: offer.supplierCostCents,
                shippingCents: offer.shippingCents,
                catalogPriceCents: offer.catalogPriceCents,
                available: offer.available,
                unavailableReason: offer.unavailableReason,
                updatedAt: at,
            };
            return [
                this.database
                    .insert(schema.catalogVariantOffers)
                    .values({ ...row, variantId, destinationCountry: offer.destinationCountry })
                    .onConflictDoUpdate({ target: [schema.catalogVariantOffers.variantId, schema.catalogVariantOffers.destinationCountry], set: row }),
            ];
        });
        // Variants the supplier no longer lists are retired, with their offers unavailable.
        const gone = existing.filter((variant) => !listed.has(variant.supplierVariantId)).map((variant) => variant.id);
        const retire = gone.flatMap((variantId) => [
            this.database.update(schema.catalogVariants).set({ status: 'retired', updatedAt: at }).where(eq(schema.catalogVariants.id, variantId)),
            this.database
                .update(schema.catalogVariantOffers)
                .set({ available: false, unavailableReason: 'retired', updatedAt: at })
                .where(eq(schema.catalogVariantOffers.variantId, variantId)),
        ]);
        await this.database.batch([updateProduct, ...variants, ...offers, ...retire]);
    }

    /**
     * Stores the failure and moves the product to the back of the refresh queue, so failing products never starve the
     * rest. `retire` stops selling a product the supplier removed.
     */
    async recordRefreshError(productId: string, message: string, now: Date, retire: boolean): Promise<void> {
        const record = this.database
            .update(schema.catalogProducts)
            .set({ lastRefreshError: message.slice(0, 500), refreshClaimedUntil: null, detailsRefreshedAt: now, updatedAt: now })
            .where(eq(schema.catalogProducts.id, productId));
        if (!retire) {
            await record;
            return;
        }
        const variants = this.database.select({ id: schema.catalogVariants.id }).from(schema.catalogVariants).where(eq(schema.catalogVariants.productId, productId));
        await this.database.batch([
            record,
            this.database
                .update(schema.catalogVariantOffers)
                .set({ available: false, unavailableReason: 'retired', updatedAt: now })
                .where(inArray(schema.catalogVariantOffers.variantId, variants)),
        ]);
    }

    async lookupOffers(catalogVariantIds: readonly string[], country: string): Promise<OfferLookup[]> {
        if (catalogVariantIds.length === 0) return [];
        const rows = await this.database
            .select({
                catalogVariantId: schema.catalogVariants.id,
                supplierVariantId: schema.catalogVariants.supplierVariantId,
                available: schema.catalogVariantOffers.available,
                catalogPriceCents: schema.catalogVariantOffers.catalogPriceCents,
                updatedAt: schema.catalogVariantOffers.updatedAt,
                productStatus: schema.catalogProducts.status,
                variantStatus: schema.catalogVariants.status,
            })
            .from(schema.catalogVariants)
            .innerJoin(schema.catalogProducts, eq(schema.catalogProducts.id, schema.catalogVariants.productId))
            .leftJoin(
                schema.catalogVariantOffers,
                and(eq(schema.catalogVariantOffers.variantId, schema.catalogVariants.id), eq(schema.catalogVariantOffers.destinationCountry, country)),
            )
            .where(inArray(schema.catalogVariants.id, [...catalogVariantIds]))
            .all();
        return rows.map((row) => ({
            catalogVariantId: row.catalogVariantId,
            supplierVariantId: row.supplierVariantId,
            // A paused or retired product, or a retired variant, never sells, whatever its last offer says.
            offer:
                row.available === null || row.updatedAt === null
                    ? null
                    : { available: row.available && row.productStatus === 'active' && row.variantStatus === 'active', catalogPriceCents: row.catalogPriceCents, updatedAt: row.updatedAt },
        }));
    }
}
