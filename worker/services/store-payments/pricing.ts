/** Prices a store cart from the store's manifest and locked catalog prices, never from the request. Pure. */

import { checkCart, type CatalogSupplier, type CheckoutCart } from '../../../shared/types/catalog';
import {
	STORE_CART_MAX_CENTS,
	STORE_CART_MAX_LINES,
	STORE_CART_MIN_CENTS,
	STORE_LINE_MAX_QUANTITY,
	type PricedCart,
	type PricedLine,
	type StoreCheckoutRefusal,
	type StoreCheckoutRequest,
	type StoreManifest,
	type StoreManifestProduct,
	type StoreManifestVariant,
} from '../../../shared/types/store-payments';

/** A catalog variant's price, locked for one destination when checkout starts. */
export type CatalogLock =
	| { ok: true; catalogVariantId: string; supplier: CatalogSupplier; supplierVariantId: string; lockedCatalogPriceCents: number }
	| { ok: false; catalogVariantId: string; reason: 'unknown' | 'unavailable' | 'ships_to_unsupported' };

export type CartContext = Pick<PricedCart, 'mode' | 'storeAppId' | 'storeVersionId' | 'commitHash' | 'sellerStripeAccountId'>;

export type PriceCartResult = { ok: true; cart: PricedCart; applicationFeeCents: number } | { ok: false; reason: StoreCheckoutRefusal };

const LOCK_REFUSALS: Readonly<Record<Extract<CatalogLock, { ok: false }>['reason'], StoreCheckoutRefusal>> = {
	unknown: 'unknown_item',
	unavailable: 'item_unavailable',
	ships_to_unsupported: 'ships_to_unsupported',
};

function refuse(reason: StoreCheckoutRefusal): PriceCartResult {
	return { ok: false, reason };
}

function variantsById(manifest: StoreManifest): Map<string, { product: StoreManifestProduct; variant: StoreManifestVariant }> {
	return new Map(manifest.products.flatMap((product) => product.variants.map((variant) => [variant.id, { product, variant }] as const)));
}

/** The catalog variants a request names, so checkout locks only those. */
export function requestedCatalogVariantIds(manifest: StoreManifest, request: StoreCheckoutRequest): string[] {
	const variants = variantsById(manifest);
	return [...new Set(request.items.flatMap((item) => variants.get(item.variantId)?.variant.catalogVariantId ?? []))];
}

export function toCheckoutCart(cart: PricedCart): CheckoutCart {
	return {
		lines: cart.lines.map((line) =>
			line.kind === 'catalog'
				? {
						kind: 'catalog',
						unitPriceCents: line.unitPriceCents,
						quantity: line.quantity,
						catalogVariantId: line.catalogVariantId,
						supplier: line.supplier,
						supplierVariantId: line.supplierVariantId,
						lockedCatalogPriceCents: line.lockedCatalogPriceCents,
					}
				: { kind: 'own', unitPriceCents: line.unitPriceCents, quantity: line.quantity },
		),
		shippingCents: cart.shippingCents,
		shipToCountry: cart.shipToCountry,
	};
}

function mergedQuantities(items: StoreCheckoutRequest['items']): Map<string, number> {
	const quantities = new Map<string, number>();
	for (const item of items) quantities.set(item.variantId, (quantities.get(item.variantId) ?? 0) + item.quantity);
	return quantities;
}

export function priceCart(input: {
	manifest: StoreManifest;
	request: StoreCheckoutRequest;
	catalogLocks: ReadonlyMap<string, CatalogLock>;
	context: CartContext;
}): PriceCartResult {
	const { manifest, request } = input;
	const quantities = mergedQuantities(request.items);
	if (quantities.size > STORE_CART_MAX_LINES) return refuse('cart_limits');
	for (const quantity of quantities.values()) {
		if (!Number.isInteger(quantity) || quantity < 1 || quantity > STORE_LINE_MAX_QUANTITY) return refuse('cart_limits');
	}

	const variants = variantsById(manifest);
	const lines: PricedLine[] = [];
	for (const [variantId, quantity] of quantities) {
		const found = variants.get(variantId);
		if (!found) return refuse('unknown_item');
		const { product, variant } = found;
		if (variant.available === false) return refuse('item_unavailable');
		if (product.type === 'digital' && variant.catalogVariantId) return refuse('invalid_request');
		const base = {
			...(product.type ? { productType: product.type } : {}),
			...(product.accountProductId ? { accountProductId: product.accountProductId } : {}),
			...(product.type === 'digital' && product.downloadAssetIds ? { downloadAssetIds: [...product.downloadAssetIds] } : {}),
			productId: product.id, variantId, name: `${product.name}, ${variant.name}`, quantity, unitPriceCents: variant.priceCents };
		if (variant.catalogVariantId === undefined) {
			lines.push({ ...base, kind: 'own' });
			continue;
		}
		const lock = input.catalogLocks.get(variant.catalogVariantId);
		if (!lock) return refuse('unknown_item');
		if (!lock.ok) return refuse(LOCK_REFUSALS[lock.reason]);
		lines.push({
			...base,
			kind: 'catalog',
			catalogVariantId: lock.catalogVariantId,
			supplier: lock.supplier,
			supplierVariantId: lock.supplierVariantId,
			destinationCountry: request.shipTo,
			lockedCatalogPriceCents: lock.lockedCatalogPriceCents,
		});
	}

	const needsShipping = lines.some((line) => line.productType !== 'digital');
	if (needsShipping && !manifest.shipping.countries.includes(request.shipTo)) return refuse('ships_to_unsupported');
	const subtotalCents = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
	const { flatRateCents, freeOverCents } = manifest.shipping;
	const shippingCents = !needsShipping || (freeOverCents !== undefined && subtotalCents >= freeOverCents) ? 0 : flatRateCents;
	const totalCents = subtotalCents + shippingCents;
	if (totalCents < STORE_CART_MIN_CENTS || totalCents > STORE_CART_MAX_CENTS) return refuse('cart_limits');

	const cart: PricedCart = { ...input.context, currency: 'usd', shipToCountry: request.shipTo, lines, subtotalCents, shippingCents, totalCents };
	const check = checkCart(toCheckoutCart(cart));
	if (!check.ok) return refuse(check.problem === 'below-minimum-price' ? 'below_minimum_price' : 'cart_limits');
	return { ok: true, cart, applicationFeeCents: check.applicationFeeCents };
}
