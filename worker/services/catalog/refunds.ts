/** Who pays for a refunded catalog item. Stripe keeps its processing fee on refunds; Estori's application fee already collected it. */

export type RefundReason = 'supplier-rejected' | 'seller-refund' | 'risk-declined';

export interface ItemRefundSplit {
	/** Refunded to the shopper. */
	shopperCents: number;
	/** Taken back from the seller's transfer. */
	sellerCents: number;
	/** Paid by Estori: the catalog price, returned when the supplier never kept it. */
	estoriCents: number;
}

/**
 * A rejected item never reached the supplier, and a supplier refund gives Estori its money back: in both cases Estori
 * returns the catalog price. Otherwise the goods were bought and shipped, so the seller bears the whole refund.
 */
export function itemRefundSplit(input: { reason: RefundReason; retailCents: number; catalogCents: number; supplierRefunded: boolean }): ItemRefundSplit {
	const { retailCents, catalogCents } = input;
	if (!Number.isInteger(retailCents) || !Number.isInteger(catalogCents) || catalogCents < 0 || retailCents < catalogCents) {
		throw new RangeError('A refund needs whole cents, with the catalog price at or below the retail price');
	}
	const estoriReturnsCatalogPrice = input.reason === 'supplier-rejected' || input.reason === 'risk-declined' || input.supplierRefunded;
	const estoriCents = estoriReturnsCatalogPrice ? catalogCents : 0;
	return { shopperCents: retailCents, sellerCents: retailCents - estoriCents, estoriCents };
}
