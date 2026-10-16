/** How catalog flows read and write orders; CatalogOrderService implements it on D1, tests use an in-memory fake. */

import type { CatalogItemStatus, CatalogOrderStatus, CatalogSupplier } from '../../../shared/types/catalog';
import type { ShippingAddress } from './supplier';

export interface NewCatalogOrderItem {
	id: string;
	catalogVariantId: string;
	supplier: CatalogSupplier;
	supplierVariantId: string;
	quantity: number;
	unitPriceCents: number;
	catalogPriceCents: number;
}

export interface NewCatalogOrder {
	id: string;
	sellerUserId: string;
	storeAppId: string;
	checkoutSessionId: string;
	paymentIntentId: string;
	totalCents: number;
	catalogTotalCents: number;
	applicationFeeCents: number;
	destinationCountry: string;
	shippingAddress: ShippingAddress;
	items: readonly NewCatalogOrderItem[];
	createdAt: Date;
}

export interface CatalogOrderItemRow {
	id: string;
	catalogVariantId: string;
	supplier: CatalogSupplier;
	supplierVariantId: string;
	quantity: number;
	unitPriceCents: number;
	catalogPriceCents: number;
	status: CatalogItemStatus;
	supplierOrderId: string | null;
	trackingNumber: string | null;
	carrier: string | null;
	supplierRefunded: boolean;
	/** Set when the shopper's refund went through: the seller's share still to reverse. */
	sellerReversalDueCents: number;
}

export interface CatalogOrderRow {
	id: string;
	status: CatalogOrderStatus;
	paymentIntentId: string;
	placementAttempts: number;
	shippingAddress: ShippingAddress;
	items: readonly CatalogOrderItemRow[];
}

export interface ItemPatch {
	itemId: string;
	status?: CatalogItemStatus;
	supplierOrderId?: string;
	trackingNumber?: string;
	carrier?: string;
	supplierRefunded?: boolean;
	sellerReversalDueCents?: number;
}

export interface CatalogOrderStore {
	/** Writes the order and its items together; false when this Checkout session already has an order. */
	insertPaidOrder(order: NewCatalogOrder): Promise<boolean>;
	getOrder(orderId: string): Promise<CatalogOrderRow | null>;
	patchItems(patches: readonly ItemPatch[]): Promise<void>;
	updateOrder(orderId: string, update: { status: CatalogOrderStatus; placementAttempts: number; lastError: string | null }): Promise<void>;
}
