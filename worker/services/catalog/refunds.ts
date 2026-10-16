/** Who pays for a refunded catalog item. Stripe keeps its processing fee on refunds, so Estori absorbs that part. */

export type RefundReason = 'supplier-rejected' | 'seller-refund';

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
	const estoriCents = input.reason === 'supplier-rejected' || input.supplierRefunded ? catalogCents : 0;
	return { shopperCents: retailCents, sellerCents: retailCents - estoriCents, estoriCents };
}
