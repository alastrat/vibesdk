/** What Estori needs from a catalog supplier. The CJdropshipping adapter implements it (see its spec). */

export { CATALOG_SUPPLIERS, type CatalogSupplier } from '../../../shared/types/catalog';
import type { CatalogSupplier, ShippingAddress } from '../../../shared/types/catalog';
export type { ShippingAddress } from '../../../shared/types/catalog';

export interface SupplierOrderLine {
	supplierVariantId: string;
	quantity: number;
}

/** 'rejected' is permanent (out of stock, unknown variant, undeliverable); 'retryable' is temporary (network, rate limit, supplier error). */
export type PlaceOrderResult =
	| { ok: true; supplierOrderId: string }
	| { ok: false; kind: 'rejected'; reason: string; rejectedVariantIds: readonly string[] }
	| { ok: false; kind: 'retryable'; reason: string };

export interface SupplierAdapter {
	readonly supplier: CatalogSupplier;
	/** `orderReference` is Estori's catalog order id; the adapter must make a repeated call with the same reference place at most one supplier order. */
	placeOrder(input: { orderReference: string; lines: readonly SupplierOrderLine[]; address: ShippingAddress }): Promise<PlaceOrderResult>;
}

/** What the supplier reports back, from webhooks or polling. */
export type SupplierUpdate =
	| { kind: 'shipped'; supplierOrderId: string; trackingNumber: string; carrier: string }
	| { kind: 'delivered'; supplierOrderId: string }
	| { kind: 'refunded'; supplierOrderId: string; supplierVariantIds: readonly string[] }
	/** The supplier cancelled after Estori paid, and refunds Estori; an empty list means the whole supplier order. */
	| { kind: 'cancelled'; supplierOrderId: string; supplierVariantIds: readonly string[]; reason: string };
