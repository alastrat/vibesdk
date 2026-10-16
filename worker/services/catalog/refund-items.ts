/**
 * Refunds catalog items: the shopper gets the retail price back, the seller's share comes back from their transfer, and
 * Estori pays the rest (the catalog price, when the supplier never kept it). Keys depend only on the items, so a retry
 * repeats the same Stripe calls instead of paying twice.
 */

import type { StripeClient } from '../payments/stripe-client';
import { itemRefundSplit, type RefundReason } from './refunds';
import type { CatalogOrderStore, ItemPatch } from './store';

export interface RefundItemsDeps {
	store: CatalogOrderStore;
	stripe: Pick<StripeClient, 'retrievePaymentIntent' | 'createRefund' | 'createTransferReversal'>;
}

export interface RefundTotals {
	refundedItemIds: readonly string[];
	shopperCents: number;
	sellerCents: number;
	estoriCents: number;
}

const NOTHING: RefundTotals = { refundedItemIds: [], shopperCents: 0, sellerCents: 0, estoriCents: 0 };

export async function refundCatalogItems(deps: RefundItemsDeps, input: { orderId: string; itemIds: readonly string[]; reason: RefundReason }): Promise<RefundTotals> {
	const order = await deps.store.getOrder(input.orderId);
	if (!order) throw new Error(`Catalog order ${input.orderId} does not exist`);
	const items = order.items.filter((item) => input.itemIds.includes(item.id) && item.status !== 'refunded').sort((a, b) => a.id.localeCompare(b.id));
	if (items.length === 0) return NOTHING;

	const totals = items.reduce(
		(sum, item) => {
			const split = itemRefundSplit({
				reason: input.reason,
				retailCents: item.unitPriceCents * item.quantity,
				catalogCents: item.catalogPriceCents * item.quantity,
				supplierRefunded: item.supplierRefunded,
			});
			return { shopperCents: sum.shopperCents + split.shopperCents, sellerCents: sum.sellerCents + split.sellerCents, estoriCents: sum.estoriCents + split.estoriCents };
		},
		{ shopperCents: 0, sellerCents: 0, estoriCents: 0 },
	);

	const intent = await deps.stripe.retrievePaymentIntent(order.paymentIntentId);
	const transferId = typeof intent.latest_charge === 'object' && intent.latest_charge !== null ? intent.latest_charge.transfer : null;
	if (!transferId) throw new Error('The payment has no transfer to the seller to reverse');

	const keySuffix = `${order.id}-${items.map((item) => item.id).join('.')}`;
	const metadata = { catalogOrderId: order.id, reason: input.reason };
	await deps.stripe.createRefund({ paymentIntentId: order.paymentIntentId, amountCents: totals.shopperCents, idempotencyKey: `catalog-refund-${keySuffix}`, metadata });
	if (totals.sellerCents > 0) {
		await deps.stripe.createTransferReversal({ transferId, amountCents: totals.sellerCents, idempotencyKey: `catalog-reversal-${keySuffix}`, metadata });
	}
	await deps.store.patchItems(items.map((item): ItemPatch => ({ itemId: item.id, status: 'refunded' })));
	return { refundedItemIds: items.map((item) => item.id), ...totals };
}
