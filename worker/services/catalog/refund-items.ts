/**
 * Refunds catalog items: the shopper gets the retail price back, the seller's share comes back from their transfer, and
 * a refund the seller started first needs their Stripe balance to cover it. Each item gets its own refund and reversal, keyed by the item, and its progress is stored right
 * after its refund, so retries, overlapping requests and late retries never refund an item twice.
 */

import type { StripeClient, StripePaymentIntent } from '../payments/stripe-client';
import { itemRefundSplit, type RefundReason } from './refunds';
import type { CatalogOrderItemRow, CatalogOrderStore } from './store';

export interface RefundItemsDeps {
	store: CatalogOrderStore;
	stripe: Pick<StripeClient, 'retrievePaymentIntent' | 'createRefund' | 'createTransferReversal'>;
	/** The seller's Stripe balance; asked only before a refund the seller started. */
	sellerBalance(): Promise<{ availableCents: number; pendingCents: number }>;
	/** Records each shopper refund against the store order. */
	recordRefund(entry: { catalogItemId: string; refundId: string; amountCents: number; reason: RefundReason }): Promise<void>;
}

export interface RefundTotals {
	refundedItemIds: readonly string[];
	shopperCents: number;
	sellerCents: number;
	estoriCents: number;
}

/** The seller's Stripe balance can't cover a refund they started; nothing was refunded. */
export class SellerBalanceShortError extends Error {
	constructor(readonly orderId: string, readonly shortCents: number) {
		super(`The seller's Stripe balance is ${shortCents} cents short to refund catalog order ${orderId}`);
		this.name = 'SellerBalanceShortError';
	}
}

const NOTHING: RefundTotals = { refundedItemIds: [], shopperCents: 0, sellerCents: 0, estoriCents: 0 };

function transferOf(intent: StripePaymentIntent): { id: string; reversibleCents: number } | null {
	const charge = intent.latest_charge;
	if (typeof charge !== 'object' || charge === null) return null;
	const transfer = charge.transfer;
	if (typeof transfer !== 'object' || transfer === null) return null;
	return { id: transfer.id, reversibleCents: transfer.amount - transfer.amount_reversed };
}

function sumOf(values: readonly number[]): number {
	return values.reduce((sum, value) => sum + value, 0);
}

export async function refundCatalogItems(deps: RefundItemsDeps, input: { orderId: string; itemIds: readonly string[]; reason: RefundReason }): Promise<RefundTotals> {
	const order = await deps.store.getOrder(input.orderId);
	if (!order) throw new Error(`Catalog order ${input.orderId} does not exist`);
	const toRefund = order.items.filter((item) => input.itemIds.includes(item.id) && item.status !== 'refunded').sort((a, b) => a.id.localeCompare(b.id));
	// Shoppers already refunded whose seller share an earlier run failed to take back.
	const owed = order.items.filter((item) => item.status === 'refunded' && item.sellerReversalDueCents > 0);
	if (toRefund.length === 0 && owed.length === 0) return NOTHING;

	const transfer = transferOf(await deps.stripe.retrievePaymentIntent(order.paymentIntentId));
	if (!transfer) throw new Error('The payment has no transfer to the seller to reverse');

	// The transfer is the whole charge, so it can always cover the seller's share; what must cover it is their balance.
	let reversible = transfer.reversibleCents - sumOf(owed.map((item) => item.sellerReversalDueCents));
	const planned = toRefund.map((item: CatalogOrderItemRow) => {
		const split = itemRefundSplit({
			reason: input.reason,
			retailCents: item.unitPriceCents * item.quantity,
			catalogCents: item.catalogPriceCents * item.quantity,
			supplierRefunded: item.supplierRefunded,
		});
		const sellerCents = Math.min(split.sellerCents, Math.max(reversible, 0));
		reversible -= sellerCents;
		return { itemId: item.id, shopperCents: split.shopperCents, sellerCents };
	});
	if (input.reason === 'seller-refund') {
		const balance = await deps.sellerBalance();
		const needed = sumOf(planned.map((item) => item.sellerCents)) + sumOf(owed.map((item) => item.sellerReversalDueCents));
		const short = needed - (balance.availableCents + balance.pendingCents);
		if (short > 0) throw new SellerBalanceShortError(order.id, short);
	}

	const metadata = { catalogOrderId: order.id, reason: input.reason };
	for (const item of planned) {
		const refund = await deps.stripe.createRefund({
			paymentIntentId: order.paymentIntentId,
			amountCents: item.shopperCents,
			idempotencyKey: `catalog-refund-${item.itemId}`,
			metadata: { ...metadata, catalogItemId: item.itemId },
		});
		await deps.recordRefund({ catalogItemId: item.itemId, refundId: refund.id, amountCents: item.shopperCents, reason: input.reason });
		await deps.store.patchItems([{ itemId: item.itemId, status: 'refunded', sellerReversalDueCents: item.sellerCents }]);
	}

	const reversals = [
		...owed.map((item) => ({ itemId: item.id, cents: item.sellerReversalDueCents })),
		...planned.filter((item) => item.sellerCents > 0).map((item) => ({ itemId: item.itemId, cents: item.sellerCents })),
	];
	for (const reversal of reversals) {
		await deps.stripe.createTransferReversal({
			transferId: transfer.id,
			amountCents: reversal.cents,
			idempotencyKey: `catalog-reversal-${reversal.itemId}`,
			metadata: { ...metadata, catalogItemId: reversal.itemId },
		});
		await deps.store.patchItems([{ itemId: reversal.itemId, sellerReversalDueCents: 0 }]);
	}

	const shopperCents = sumOf(planned.map((item) => item.shopperCents));
	const sellerCents = sumOf(planned.map((item) => item.sellerCents));
	return { refundedItemIds: planned.map((item) => item.itemId), shopperCents, sellerCents, estoriCents: shopperCents - sellerCents };
}
