/** Catalog values shared by the database schema, the worker and the store builder. All amounts are US cents. */

export const CATALOG_SUPPLIERS = ['cjdropshipping'] as const;
export type CatalogSupplier = (typeof CATALOG_SUPPLIERS)[number];

/** A catalog order waits for placement, is done (each item placed or rejected), or needs the owner. */
export const CATALOG_ORDER_STATUSES = ['awaiting-placement', 'placement-done', 'needs-attention'] as const;
export type CatalogOrderStatus = (typeof CATALOG_ORDER_STATUSES)[number];

/** `withheld`: never placed, because a dispute already returned the payment; neither placed nor refunded. */
export const CATALOG_ITEM_STATUSES = ['pending', 'placed', 'rejected', 'shipped', 'delivered', 'refunded', 'withheld'] as const;
export type CatalogItemStatus = (typeof CATALOG_ITEM_STATUSES)[number];

/** Estori's margin, a percentage of supplier cost plus shipping. Provisional: the owner confirms it before launch. */
export const CATALOG_MARGIN_PERCENT = 20;

/** Stripe's standard US card rate. Estori pays it on destination charges, so its fee covers it. */
export const CATALOG_PROCESSING_PERCENT = 2.9;
export const CATALOG_PROCESSING_FIXED_CENTS = 30;

/** Estori's fee on an order with bring-your-own items, once per order. Provisional, like the margin. */
export const BYO_ORDER_FEE_CENTS = 50;

interface CartLineBase {
	/** The seller's retail price for one unit. */
	unitPriceCents: number;
	quantity: number;
}

export interface OwnCartLine extends CartLineBase {
	kind: 'own';
}

export interface CatalogCartLine extends CartLineBase {
	kind: 'catalog';
	catalogVariantId: string;
	supplier: CatalogSupplier;
	supplierVariantId: string;
	/** Locked when checkout starts, for the cart's ship-to country. */
	lockedCatalogPriceCents: number;
}

export interface ByoCartLine extends CartLineBase {
	kind: 'byo';
	catalogVariantId: string;
}

export type CartLine = OwnCartLine | CatalogCartLine | ByoCartLine;

export interface CheckoutCart {
	lines: readonly CartLine[];
	/** What the shopper pays the store for shipping. */
	shippingCents: number;
	/** ISO 3166-1 alpha-2; the catalog prices are locked for it. */
	shipToCountry: string;
}

export type CartProblem = 'empty' | 'invalid-amount' | 'below-minimum-price' | 'fee-exceeds-total';
export type CartCheck = { ok: true; totalCents: number; applicationFeeCents: number } | { ok: false; problem: CartProblem };

export function catalogPriceCents(input: { supplierCostCents: number; shippingCents: number }): number {
	const base = input.supplierCostCents + input.shippingCents;
	return base + Math.round((base * CATALOG_MARGIN_PERCENT) / 100);
}

export function processingFeeCents(amountCents: number): number {
	if (amountCents <= 0) return 0;
	return Math.round((amountCents * CATALOG_PROCESSING_PERCENT) / 100) + CATALOG_PROCESSING_FIXED_CENTS;
}

/** The lowest retail price whose remainder after the processing fee still covers the catalog price. */
export function minimumRetailPriceCents(catalogPrice: number): number {
	let price = Math.ceil((catalogPrice + CATALOG_PROCESSING_FIXED_CENTS) / (1 - CATALOG_PROCESSING_PERCENT / 100));
	while (price - processingFeeCents(price) < catalogPrice) price += 1;
	while (price > 1 && price - 1 - processingFeeCents(price - 1) >= catalogPrice) price -= 1;
	return price;
}

export function cartTotalCents(cart: CheckoutCart): number {
	return cart.lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0) + cart.shippingCents;
}

export function catalogTotalCents(cart: CheckoutCart): number {
	return cart.lines.reduce((sum, line) => (line.kind === 'catalog' ? sum + line.lockedCatalogPriceCents * line.quantity : sum), 0);
}

/** Estori's share of a store payment: catalog prices, the bring-your-own fee once, and processing on the whole payment. */
export function applicationFeeCents(cart: CheckoutCart): number {
	const byoFee = cart.lines.some((line) => line.kind === 'byo') ? BYO_ORDER_FEE_CENTS : 0;
	return catalogTotalCents(cart) + byoFee + processingFeeCents(cartTotalCents(cart));
}

function isCount(value: number): boolean {
	return Number.isInteger(value) && value >= 0;
}

/** Whether a cart can be paid: valid amounts, catalog prices at or above their minimum, and a fee below the total. */
export function checkCart(cart: CheckoutCart): CartCheck {
	if (cart.lines.length === 0) return { ok: false, problem: 'empty' };
	const amounts = [cart.shippingCents, ...cart.lines.flatMap((line) => [line.unitPriceCents, ...(line.kind === 'catalog' ? [line.lockedCatalogPriceCents] : [])])];
	const invalid = !amounts.every(isCount) || cart.lines.some((line) => !Number.isInteger(line.quantity) || line.quantity < 1);
	if (invalid) return { ok: false, problem: 'invalid-amount' };
	if (cart.lines.some((line) => line.kind === 'catalog' && line.unitPriceCents < minimumRetailPriceCents(line.lockedCatalogPriceCents))) {
		return { ok: false, problem: 'below-minimum-price' };
	}
	const totalCents = cartTotalCents(cart);
	const fee = applicationFeeCents(cart);
	// Stripe requires the application fee to be below the payment.
	if (fee >= totalCents) return { ok: false, problem: 'fee-exceeds-total' };
	return { ok: true, totalCents, applicationFeeCents: fee };
}

/** Where catalog items ship, each from one origin warehouse country, so an order's lines share one origin. */
export const CATALOG_DESTINATIONS: Readonly<Record<string, { name: string; origin: string }>> = {
	US: { name: 'United States', origin: 'US' },
};

export const CATALOG_PRODUCT_STATUSES = ['active', 'paused', 'retired'] as const;
export type CatalogProductStatus = (typeof CATALOG_PRODUCT_STATUSES)[number];
export const CATALOG_VARIANT_STATUSES = ['active', 'retired'] as const;
export type CatalogVariantStatus = (typeof CATALOG_VARIANT_STATUSES)[number];
export const CATALOG_OFFER_UNAVAILABLE_REASONS = ['out-of-stock', 'no-shipping', 'paused', 'retired'] as const;
export type CatalogOfferUnavailableReason = (typeof CATALOG_OFFER_UNAVAILABLE_REASONS)[number];

export interface CatalogVariantView {
	catalogVariantId: string;
	name: string;
	options: Record<string, string>;
	imageUrl: string | null;
	available: boolean;
	deliveryDays: { min: number | null; max: number | null } | null;
	/** What one unit costs the seller, US delivery included; null when it can't be sold now. */
	catalogPriceCents: number | null;
	minimumRetailPriceCents: number | null;
	suggestedRetailPriceCents: number | null;
}

export interface CatalogProductView {
	productId: string;
	title: string;
	description: string;
	category: string;
	imageUrls: string[];
	/** Destinations where at least one variant can be sold now. */
	shipsTo: string[];
	variants: CatalogVariantView[];
}

export interface CatalogProductsData {
	products: CatalogProductView[];
}

/** Twice the catalog price, ending in 99 cents, and never below the minimum retail price. */
export function suggestedRetailPriceCents(catalogPrice: number): number {
	return Math.max(Math.ceil((catalogPrice * 2) / 100) * 100 - 1, minimumRetailPriceCents(catalogPrice));
}
