/** The records store payments read and write, independent of D1 so the orchestration is tested with fakes. */

import type {
	PricedCart,
	StoreCheckoutStatus,
	StoreFulfillmentStatus,
	StoreLineKind,
	StoreMode,
	StorePaymentStatus,
} from '../../../shared/types/store-payments';
import type { ShippingAddress } from '../catalog/supplier';

export interface StoreCheckoutRecord {
	id: string;
	mode: StoreMode;
	appId: string;
	storeVersionId: string | null;
	commitHash: string;
	sellerUserId: string;
	sellerStripeAccountId: string | null;
	shipToCountry: string;
	pricedCart: PricedCart;
	subtotalCents: number;
	shippingCents: number;
	totalCents: number;
	applicationFeeCents: number;
	status: StoreCheckoutStatus;
	successPath: string;
	cancelPath: string;
	note: string | null;
	createdAt: Date;
	expiresAt: Date;
}

export interface NewStoreOrderItem {
	lineNo: number;
	kind: StoreLineKind;
	productId: string;
	variantId: string;
	name: string;
	quantity: number;
	unitPriceCents: number;
	catalogVariantId: string | null;
	lockedCatalogPriceCents: number | null;
}

export interface NewStoreOrder {
	id: string;
	checkoutId: string;
	mode: StoreMode;
	appId: string;
	sellerUserId: string;
	sellerStripeAccountId: string | null;
	storeVersionId: string | null;
	stripeCheckoutSessionId: string | null;
	stripePaymentIntentId: string | null;
	subtotalCents: number;
	shippingCents: number;
	totalCents: number;
	applicationFeeCents: number;
	customerEmail: string | null;
	customerName: string | null;
	shippingAddress: ShippingAddress | null;
	note: string | null;
	/** Why the owner must look at this order, or null. */
	needsAttention: string | null;
	items: NewStoreOrderItem[];
	createdAt: Date;
}

export interface StoreOrderView {
	id: string;
	orderNumber: number;
	mode: StoreMode;
	appId: string;
	paymentStatus: StorePaymentStatus;
	fulfillmentStatus: StoreFulfillmentStatus;
	subtotalCents: number;
	shippingCents: number;
	totalCents: number;
	applicationFeeCents: number;
	currency: string;
	customerEmail: string | null;
	customerName: string | null;
	shippingAddress: ShippingAddress | null;
	note: string | null;
	needsAttention: string | null;
	stripeCheckoutSessionId: string | null;
	stripePaymentIntentId: string | null;
	sellerUserId: string;
	/** Nullable in the table; every order recorded from a checkout has one. */
	sellerStripeAccountId: string | null;
	refundedCents: number;
	createdAt: Date;
	items: NewStoreOrderItem[];
}
