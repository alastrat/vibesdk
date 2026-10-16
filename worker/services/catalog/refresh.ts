/**
 * One refresh run: claim the stalest products, read each from CJ (details, stock, freight per destination), copy new
 * images, and write variants and per-destination offers. A product that fails is recorded and the batch moves on.
 */

import { CATALOG_DESTINATIONS, catalogPriceCents, type CatalogOfferUnavailableReason } from '../../../shared/types/catalog';
import { catalogText } from './catalog-text';
import type { CatalogRefreshStore, ClaimedProduct, RefreshedOffer, RefreshedProduct, RefreshedVariant } from './catalog-store';
import type { CjClient } from './cj/client';
import type { CjFreightOption, CjInventory, CjProduct, CjVariant } from './cj/types';
import { CATALOG_MAX_DELIVERY_DAYS, CATALOG_MAX_IMAGES, CATALOG_MIN_STOCK, CATALOG_REFRESH_BATCH, CJ_POINTS_RESERVE } from './config';
import { usdToCents } from './money';

export interface RefreshDeps {
	client: Pick<CjClient, 'queryProduct' | 'inventoryByPid' | 'freightCalculate' | 'pointsRemaining'>;
	store: CatalogRefreshStore;
	images: { copy(productId: string, sourceUrl: string): Promise<string | null> };
	now(): number;
}

export interface ChosenFreight {
	logisticName: string;
	shippingCents: number;
	daysMin: number | null;
	daysMax: number | null;
}

const ON_SALE = '3';

function deliveryDays(aging: string | null): { min: number | null; max: number | null } {
	const numbers = (aging ?? '').match(/\d+/g)?.map(Number) ?? [];
	if (numbers.length === 0) return { min: null, max: null };
	return { min: Math.min(...numbers), max: Math.max(...numbers) };
}

/** Options that arrive within `maxDays`, cheapest first, then quickest. */
export function chooseFreight(options: readonly CjFreightOption[], maxDays: number): ChosenFreight | null {
	const candidates = options.flatMap((option) => {
		const shippingCents = usdToCents(option.totalPostageFee ?? option.logisticPrice ?? '');
		const days = deliveryDays(option.logisticAging);
		if (shippingCents === null || days.max === null || days.max > maxDays) return [];
		return [{ logisticName: option.logisticName, shippingCents, daysMin: days.min, daysMax: days.max }];
	});
	candidates.sort((a, b) => a.shippingCents - b.shippingCents || (a.daysMax ?? 0) - (b.daysMax ?? 0));
	return candidates[0] ?? null;
}

function imageUrls(product: CjProduct): string[] {
	if (product.productImageSet && product.productImageSet.length > 0) return product.productImageSet;
	try {
		const parsed: unknown = JSON.parse(product.productImage ?? '[]');
		return Array.isArray(parsed) ? parsed.filter((url): url is string => typeof url === 'string') : [];
	} catch {
		return [];
	}
}

function optionsOf(product: CjProduct, variant: CjVariant): Record<string, string> {
	const value = variant.variantKey ?? variant.variantNameEn ?? '';
	const names = (product.productKeyEn ?? '').split('-').map((name) => name.trim()).filter(Boolean);
	const values = value.split('-').map((part) => part.trim());
	if (names.length > 1 && names.length === values.length) return Object.fromEntries(names.map((name, index) => [name, values[index]]));
	return value ? { [names[0] ?? 'Option']: value } : {};
}

function stockOf(inventory: CjInventory, vid: string): Record<string, number> {
	const entry = inventory.variantInventories?.find((item) => item.vid === vid);
	return Object.fromEntries((entry?.inventory ?? []).map((row) => [row.countryCode, row.totalInventory]));
}

function attributesOf(product: CjProduct): Record<string, string> {
	const material = Array.isArray(product.materialNameEn) ? product.materialNameEn.join(', ') : product.materialNameEn;
	return material ? { Material: material } : {};
}

async function refreshOne(deps: RefreshDeps, claimed: ClaimedProduct): Promise<RefreshedProduct> {
	const product = await deps.client.queryProduct(claimed.supplierProductId);
	const inventory = await deps.client.inventoryByPid(claimed.supplierProductId);
	const onSale = String(product.status) === ON_SALE;

	const imageKeys = (await Promise.all(imageUrls(product).slice(0, CATALOG_MAX_IMAGES).map((url) => deps.images.copy(claimed.id, url)))).filter(
		(key): key is string => key !== null,
	);
	const variants: RefreshedVariant[] = [];
	for (const variant of product.variants) {
		const supplierCostCents = usdToCents(variant.variantSellPrice);
		if (supplierCostCents === null) continue;
		variants.push({
			supplierVariantId: variant.vid,
			sku: variant.variantSku,
			name: variant.variantNameEn || variant.variantKey || product.productNameEn,
			options: optionsOf(product, variant),
			imageKey: variant.variantImage ? await deps.images.copy(claimed.id, variant.variantImage) : null,
			weightGrams: Math.round(Number(variant.variantWeight ?? 0)) || 0,
			supplierCostCents,
			stock: stockOf(inventory, variant.vid),
			status: onSale ? 'active' : 'retired',
		});
	}

	const offers: RefreshedOffer[] = [];
	for (const [destination, { origin }] of Object.entries(CATALOG_DESTINATIONS)) {
		// Variants of the same weight share one freight quote.
		const quotes = new Map<number, ChosenFreight | null>();
		for (const variant of variants) {
			if (!quotes.has(variant.weightGrams)) {
				const options = await deps.client.freightCalculate({ startCountryCode: origin, endCountryCode: destination, products: [{ vid: variant.supplierVariantId, quantity: 1 }] });
				quotes.set(variant.weightGrams, chooseFreight(options, CATALOG_MAX_DELIVERY_DAYS[destination] ?? 10));
			}
			const freight = quotes.get(variant.weightGrams) ?? null;
			const reason: CatalogOfferUnavailableReason | null =
				variant.status === 'retired'
					? 'retired'
					: claimed.status !== 'active'
						? 'paused'
						: !freight
							? 'no-shipping'
							: (variant.stock[origin] ?? 0) < CATALOG_MIN_STOCK
								? 'out-of-stock'
								: null;
			offers.push({
				supplierVariantId: variant.supplierVariantId,
				destinationCountry: destination,
				originCountry: origin,
				logisticName: freight?.logisticName ?? null,
				deliveryDaysMin: freight?.daysMin ?? null,
				deliveryDaysMax: freight?.daysMax ?? null,
				supplierCostCents: variant.supplierCostCents,
				shippingCents: freight?.shippingCents ?? null,
				catalogPriceCents: freight ? catalogPriceCents({ supplierCostCents: variant.supplierCostCents, shippingCents: freight.shippingCents }) : null,
				available: reason === null,
				unavailableReason: reason,
			});
		}
	}

	return {
		productId: claimed.id,
		title: claimed.title ?? product.productNameEn.trim(),
		description: catalogText(product.description),
		category: product.categoryName,
		imageKeys,
		attributes: attributesOf(product),
		variants,
		offers,
		refreshedAt: new Date(deps.now()),
	};
}

export async function refreshCatalogBatch(deps: RefreshDeps, limit: number = CATALOG_REFRESH_BATCH): Promise<{ refreshed: number; failed: number; stoppedForPoints: boolean }> {
	const claimed = await deps.store.claimForRefresh(limit, new Date(deps.now()));
	let refreshed = 0;
	let failed = 0;
	for (const product of claimed) {
		const points = deps.client.pointsRemaining();
		if (points !== null && points < CJ_POINTS_RESERVE) return { refreshed, failed, stoppedForPoints: true };
		try {
			await deps.store.saveRefresh(await refreshOne(deps, product));
			refreshed += 1;
		} catch (error) {
			failed += 1;
			await deps.store.recordRefreshError(product.id, error instanceof Error ? error.message : String(error), new Date(deps.now()));
		}
	}
	return { refreshed, failed, stoppedForPoints: false };
}
