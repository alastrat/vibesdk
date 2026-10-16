/** Store payments: a store's price list (`estori-store.json`), the checkout request and answer, and the priced cart. Amounts are US cents. */

import type { CatalogItemStatus, CatalogSupplier } from './catalog';

export const STORE_MANIFEST_FILE = 'estori-store.json';
/** Every path under it on a store's address belongs to the platform. */
export const STORE_PLATFORM_PREFIX = '/__estori';
/** `metadata.kind` of every store Checkout session. */
export const STORE_ORDER_KIND = 'store_order';

export const STORE_CART_MIN_CENTS = 50;
/** A fraud cap on one order. */
export const STORE_CART_MAX_CENTS = 1_000_000;
export const STORE_CART_MAX_LINES = 50;
export const STORE_LINE_MAX_QUANTITY = 99;
export const STORE_PRICE_MIN_CENTS = 50;
export const STORE_PRICE_MAX_CENTS = 1_000_000;

export const STORE_MODES = ['test', 'live'] as const;
export type StoreMode = (typeof STORE_MODES)[number];
export const STORE_CHECKOUT_STATUSES = ['creating', 'open', 'completed', 'expired', 'failed'] as const;
export type StoreCheckoutStatus = (typeof STORE_CHECKOUT_STATUSES)[number];
export const STORE_PAYMENT_STATUSES = ['paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost'] as const;
export type StorePaymentStatus = (typeof STORE_PAYMENT_STATUSES)[number];
export const STORE_FULFILLMENT_STATUSES = ['unfulfilled', 'fulfilled'] as const;
export type StoreFulfillmentStatus = (typeof STORE_FULFILLMENT_STATUSES)[number];
export const STORE_LINE_KINDS = ['own', 'catalog'] as const;
export type StoreLineKind = (typeof STORE_LINE_KINDS)[number];
export const STORE_REFUND_INITIATORS = ['seller', 'estori'] as const;
export type StoreRefundInitiator = (typeof STORE_REFUND_INITIATORS)[number];
export const SELLER_CHARGE_KINDS = ['dispute-fee', 'dispute-shortfall', 'payout-fee', 'active-account-fee'] as const;
export type SellerChargeKind = (typeof SELLER_CHARGE_KINDS)[number];
export const PAYOUT_INTERVALS = ['daily', 'weekly', 'monthly'] as const;
export type PayoutInterval = (typeof PAYOUT_INTERVALS)[number];

export interface StoreManifestVariant {
	id: string;
	name: string;
	/** The seller's retail price for one unit. */
	priceCents: number;
	available?: boolean;
	/** Set on catalog products: the catalog variant this sells. The catalog price never appears in the file. */
	catalogVariantId?: string;
}

export interface StoreManifestProduct {
	id: string;
	name: string;
	description?: string;
	image?: string;
	variants: StoreManifestVariant[];
}

export interface StoreShipping {
	/** ISO 3166-1 alpha-2 codes. */
	countries: string[];
	/** Per order; 0 is free shipping. */
	flatRateCents: number;
	/** Shipping is free for subtotals at or above it. */
	freeOverCents?: number;
}

export interface StoreManifest {
	version: 1;
	currency: 'usd';
	shipping: StoreShipping;
	products: StoreManifestProduct[];
}

export interface StoreCheckoutRequest {
	items: { variantId: string; quantity: number }[];
	shipTo: string;
	successPath?: string;
	cancelPath?: string;
	note?: string;
}

export type StoreCheckoutRefusal =
	| 'payments_unavailable'
	| 'demo_only'
	| 'invalid_request'
	| 'unknown_item'
	| 'item_unavailable'
	| 'ships_to_unsupported'
	| 'below_minimum_price'
	| 'cart_limits'
	| 'stripe_failed';

export type StoreCheckoutResponse = { ok: true; checkoutUrl: string } | { ok: false; reason: StoreCheckoutRefusal; message: string };

/** What the shopper reads for each refusal; never the internal reason. */
export const STORE_CHECKOUT_MESSAGES: Readonly<Record<StoreCheckoutRefusal, string>> = {
	payments_unavailable: "This store can't take payments right now.",
	demo_only: 'This is a demo. Checkout works on the live store.',
	invalid_request: "Your cart couldn't be read. Refresh the page and try again.",
	unknown_item: 'An item in your cart is no longer sold here.',
	item_unavailable: 'An item in your cart is sold out.',
	ships_to_unsupported: "This store doesn't ship to that country.",
	below_minimum_price: "An item in your cart can't be sold at its current price.",
	cart_limits: "Your cart is more than one order can hold.",
	stripe_failed: "Checkout couldn't start. Try again in a moment.",
};

interface PricedLineBase {
	productId: string;
	variantId: string;
	/** "Product, Variant", as the shopper sees it in Checkout. */
	name: string;
	quantity: number;
	unitPriceCents: number;
}

/** The cart shape the catalog fee reads, through `toCheckoutCart`. */
export type PricedLine =
	| (PricedLineBase & { kind: 'own' })
	| (PricedLineBase & {
			kind: 'catalog';
			catalogVariantId: string;
			supplier: CatalogSupplier;
			supplierVariantId: string;
			destinationCountry: string;
			lockedCatalogPriceCents: number;
	  });

export interface PricedCart {
	mode: StoreMode;
	storeAppId: string;
	/** The live store version; null for test checkouts, which price from the preview commit. */
	storeVersionId: string | null;
	commitHash: string;
	/** The seller's connected account. */
	sellerStripeAccountId: string | null;
	currency: 'usd';
	shipToCountry: string;
	lines: PricedLine[];
	subtotalCents: number;
	shippingCents: number;
	totalCents: number;
}

/** `Estori.store()`: what a store page renders and whether it may offer checkout. */
export interface StoreInfo {
	mode: StoreMode;
	paymentsAvailable: boolean;
	currency: 'usd';
	shipping: StoreShipping;
	products: StoreManifestProduct[];
}

/** `Estori.order(id)`: the shopper's receipt. Never the street address or phone. */
export interface StoreReceipt {
	orderId: string;
	orderNumber: number;
	createdAt: string;
	mode: StoreMode;
	paymentStatus: StorePaymentStatus;
	items: { name: string; quantity: number; unitPriceCents: number }[];
	subtotalCents: number;
	shippingCents: number;
	totalCents: number;
	shipCity: string | null;
	shipCountry: string | null;
	customerEmail: string | null;
}

/** A catalog item's progress, as the seller sees it on an order. */
export interface CatalogItemProgress {
	catalogVariantId: string;
	quantity: number;
	status: CatalogItemStatus;
	trackingNumber: string | null;
	carrier: string | null;
}

export interface StoreOrderSummary {
	id: string;
	orderNumber: number;
	mode: StoreMode;
	paymentStatus: StorePaymentStatus;
	fulfillmentStatus: StoreFulfillmentStatus;
	subtotalCents: number;
	shippingCents: number;
	totalCents: number;
	/** Estori's application fee: processing, plus the catalog price of catalog items. */
	applicationFeeCents: number;
	customerName: string | null;
	customerEmail: string | null;
	shipTo: { name: string; line1: string; line2: string | null; city: string; region: string | null; postalCode: string; countryCode: string } | null;
	needsAttention: string | null;
	createdAt: string;
	items: { name: string; kind: StoreLineKind; quantity: number; unitPriceCents: number }[];
	catalogItems: CatalogItemProgress[];
}

export interface StoreOrdersData {
	orders: StoreOrderSummary[];
}
