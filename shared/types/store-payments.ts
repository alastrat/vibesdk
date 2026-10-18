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
/** An order note, such as a gift message: kept with the cart, shown on the checkout page and stored on the order. */
export const STORE_NOTE_MAX_LENGTH = 500;
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
/** `refund-shortfall`: a refund's seller share that the sale's transfer could no longer cover, taken from later sales. */
export const SELLER_CHARGE_KINDS = ['dispute-fee', 'dispute-shortfall', 'payout-fee', 'active-account-fee', 'refund-shortfall'] as const;
export type SellerChargeKind = (typeof SELLER_CHARGE_KINDS)[number];
export const DISPUTE_REVERSAL_STATES = ['none', 'planned', 'done', 'refused'] as const;
export type DisputeReversalState = (typeof DISPUTE_REVERSAL_STATES)[number];
/** Stripe's final dispute statuses: decided for either side, or an inquiry that closed without a chargeback. */
export const DISPUTE_CLOSED_STATUSES: readonly string[] = ['won', 'lost', 'warning_closed'];
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

export const STORE_BRAND_CORNERS = ['square', 'rounded', 'pill'] as const;
export type StoreBrandCorners = (typeof STORE_BRAND_CORNERS)[number];

/** How the store looks, for Estori's checkout page and Stripe's payment fields. Colors are #rrggbb. */
export interface StoreBrand {
	name: string;
	/** A path on the store, or an absolute address. */
	logo?: string;
	colors: { background: string; surface: string; text: string; accent: string; accentText: string };
	/** A Google Fonts family name. */
	font?: string;
	corners: StoreBrandCorners;
}

export interface StoreManifest {
	version: 1;
	currency: 'usd';
	shipping: StoreShipping;
	products: StoreManifestProduct[];
	/** Optional: a store without it gets a neutral checkout page. */
	brand?: StoreBrand;
}

export interface StoreCheckoutRequest {
	items: { variantId: string; quantity: number }[];
	shipTo: string;
	successPath?: string;
	cancelPath?: string;
	note?: string;
	/** The checkout this one replaces after the shopper edited the cart on Estori's checkout page. */
	replaces?: string;
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
	| 'order_over_limit'
	| 'store_paused'
	| 'too_many_checkouts'
	| 'stripe_failed';

/** One line of the order summary on Estori's checkout page, priced by Estori. */
export interface StoreCheckoutSummaryLine {
	variantId: string;
	productId: string;
	name: string;
	variantName: string;
	image?: string;
	quantity: number;
	unitPriceCents: number;
	lineTotalCents: number;
}

export interface StoreCheckoutSummary {
	currency: 'usd';
	shipTo: string;
	lines: StoreCheckoutSummaryLine[];
	subtotalCents: number;
	shippingCents: number;
	totalCents: number;
}

export interface StoreCartItem {
	variantId: string;
	quantity: number;
}

/** `Estori.cart` in `/__estori/store.js`: the one cart a store and Estori's checkout page share, per store. */
export interface StoreCartApi {
	items(): StoreCartItem[];
	add(variantId: string, quantity?: number): void;
	/** 0 removes the line. */
	setQuantity(variantId: string, quantity: number): void;
	remove(variantId: string): void;
	clear(): void;
	/** Units in all lines. */
	count(): number;
	shipTo(): string | null;
	setShipTo(country: string): void;
	/** The order note, or an empty string. */
	note(): string;
	/** Trimmed and cut to STORE_NOTE_MAX_LENGTH; an empty note removes it. Clearing the cart removes it too. */
	setNote(note: string): void;
	/** Called after every change, here or in another tab; returns a function that stops listening. */
	onChange(listener: (items: StoreCartItem[]) => void): () => void;
}

/** A started checkout: the session's client secret for Stripe's payment form, and the order as Estori priced it. */
export type StoreCheckoutResponse =
	| { ok: true; checkoutId: string; clientSecret: string; summary: StoreCheckoutSummary }
	| { ok: false; reason: StoreCheckoutRefusal; message: string };

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
	order_over_limit: "This store can't take an order this large yet.",
	store_paused: "This store isn't taking new orders right now. Try again later.",
	too_many_checkouts: 'Too many checkouts were started from here. Wait a few minutes and try again.',
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
	/** For the store's pages and Estori's checkout page; null when the store declared none. */
	brand: StoreBrand | null;
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
	/** The shopper's order note, such as a gift message. */
	note: string | null;
	needsAttention: string | null;
	createdAt: string;
	items: { name: string; kind: StoreLineKind; quantity: number; unitPriceCents: number }[];
	catalogItems: CatalogItemProgress[];
}

export interface StoreOrdersData {
	orders: StoreOrderSummary[];
}

export interface StoreRefundRequest {
	lineNos: number[];
	/** Made once per refund attempt by the client, so a retried request refunds once. */
	requestId: string;
}

export interface StoreRefundResponse {
	refundedCents: number;
}

/** The seller's Orders page; the new-order email links to one order under it. */
export const SELLER_ORDERS_PATH = '/orders';

export function sellerOrderPath(orderId: string): string {
	return `${SELLER_ORDERS_PATH}/${encodeURIComponent(orderId)}`;
}

/** Orders with items the seller ships and hasn't yet, or every order. */
export const SELLER_ORDER_VIEWS = ['to-ship', 'all'] as const;
export type SellerOrderView = (typeof SELLER_ORDER_VIEWS)[number];

/** Live orders only, or test orders too. */
export const SELLER_ORDER_MODES = ['live', 'all'] as const;
export type SellerOrderModeFilter = (typeof SELLER_ORDER_MODES)[number];

export function isSellerOrderView(value: string): value is SellerOrderView {
	return (SELLER_ORDER_VIEWS as readonly string[]).includes(value);
}

export function isSellerOrderModeFilter(value: string): value is SellerOrderModeFilter {
	return (SELLER_ORDER_MODES as readonly string[]).includes(value);
}

export const SELLER_CARRIERS = ['usps', 'ups', 'fedex', 'dhl', 'other'] as const;
export type SellerCarrier = (typeof SELLER_CARRIERS)[number];
export const SELLER_CARRIER_NAMES: Readonly<Record<Exclude<SellerCarrier, 'other'>, string>> = { usps: 'USPS', ups: 'UPS', fedex: 'FedEx', dhl: 'DHL' };

/** An order in the seller's list. */
export interface SellerOrderRow {
	id: string;
	orderNumber: number;
	mode: StoreMode;
	appId: string;
	/** Null when the store's app was deleted. */
	storeTitle: string | null;
	createdAt: string;
	customerName: string | null;
	customerEmail: string | null;
	totalCents: number;
	paymentStatus: StorePaymentStatus;
	fulfillmentStatus: StoreFulfillmentStatus;
	units: number;
	/** Units of the seller's own products with no refund: what they ship. */
	ownUnits: number;
	/** Units of catalog items with no refund: what Estori ships. */
	catalogUnits: number;
}

export interface SellerOrdersData {
	orders: SellerOrderRow[];
	nextCursor: string | null;
	/** The stores the seller has orders in, for the store filter. */
	stores: { appId: string; title: string | null }[];
	/** The seller has test orders, so the page can say they're hidden. */
	hasTestOrders: boolean;
}

export interface SellerOrderLine {
	lineNo: number;
	name: string;
	kind: StoreLineKind;
	quantity: number;
	unitPriceCents: number;
	catalogVariantId: string | null;
	/** A refund was claimed or made for this line. */
	refunded: boolean;
}

export interface SellerOrderDetail extends Omit<StoreOrderSummary, 'items'> {
	appId: string;
	storeTitle: string | null;
	customerPhone: string | null;
	refundedCents: number;
	carrier: string | null;
	trackingNumber: string | null;
	shippedAt: string | null;
	/** The latest dispute, when the shopper disputed the payment. */
	dispute: { amountCents: number; status: string } | null;
	items: SellerOrderLine[];
}

export type SellerShipmentRequest =
	| { shipped: true; carrier: SellerCarrier | null; carrierName?: string; trackingNumber?: string | null }
	| { shipped: false };
