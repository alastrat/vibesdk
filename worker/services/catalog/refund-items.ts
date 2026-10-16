/**
 * Refunds catalog items: the shopper gets the retail price back, the seller's share comes back from their transfer (and
 * whatever the transfer can no longer cover from their later sales), and a refund the seller started first needs their
 * Stripe balance to cover it. Each item gets its own refund and reversal, keyed by the item, and its progress is stored right
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
	/** A charge, once per item, for the seller share the transfer could no longer cover; taken from later sales. */
	addShortfall(shortfall: { catalogItemId: string; amountCents: number }): Promise<void>;
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

interface CatalogRefundPlan {
	orderId: string;
	paymentIntentId: string;
	transferId: string;
	owed: ReadonlyArray<{ itemId: string; cents: number }>;
	/** Per item: what the shopper gets, what the transfer gives back now, and what later sales must cover. */
	planned: ReadonlyArray<{ itemId: string; shopperCents: number; sellerCents: number; shortfallCents: number }>;
}

/** Reads the order and the transfer and plans every amount; nothing moves. Null when there is nothing to do. */
async function planCatalogRefund(deps: Pick<RefundItemsDeps, 'store' | 'stripe'>, input: { orderId: string; itemIds: readonly string[]; reason: RefundReason }): Promise<CatalogRefundPlan | null> {
	const order = await deps.store.getOrder(input.orderId);
	if (!order) throw new Error(`Catalog order ${input.orderId} does not exist`);
	const toRefund = order.items.filter((item) => input.itemIds.includes(item.id) && item.status !== 'refunded').sort((a, b) => a.id.localeCompare(b.id));
	// Shoppers already refunded whose seller share an earlier run failed to take back.
	const owed = order.items.filter((item) => item.status === 'refunded' && item.sellerReversalDueCents > 0).map((item) => ({ itemId: item.id, cents: item.sellerReversalDueCents }));
	if (toRefund.length === 0 && owed.length === 0) return null;

	const transfer = transferOf(await deps.stripe.retrievePaymentIntent(order.paymentIntentId));
	if (!transfer) throw new Error('The payment has no transfer to the seller to reverse');

	// The transfer gives back what is left of it; earlier refunds, collections and disputes may have drawn it down.
	let reversible = transfer.reversibleCents - sumOf(owed.map((item) => item.cents));
	const planned = toRefund.map((item: CatalogOrderItemRow) => {
		const split = itemRefundSplit({
			reason: input.reason,
			retailCents: item.unitPriceCents * item.quantity,
			catalogCents: item.catalogPriceCents * item.quantity,
			supplierRefunded: item.supplierRefunded,
		});
		const sellerCents = Math.min(split.sellerCents, Math.max(reversible, 0));
		reversible -= sellerCents;
		return { itemId: item.id, shopperCents: split.shopperCents, sellerCents, shortfallCents: split.sellerCents - sellerCents };
	});
	return { orderId: order.id, paymentIntentId: order.paymentIntentId, transferId: transfer.id, owed, planned };
}

/** What refunding these items would take back from the seller's transfer now; nothing moves. */
export async function catalogRefundSellerCents(deps: Pick<RefundItemsDeps, 'store' | 'stripe'>, input: { orderId: string; itemIds: readonly string[]; reason: RefundReason }): Promise<number> {
	const plan = await planCatalogRefund(deps, input);
	return plan ? sumOf(plan.planned.map((item) => item.sellerCents)) + sumOf(plan.owed.map((item) => item.cents)) : 0;
}

export async function refundCatalogItems(
	deps: RefundItemsDeps,
	input: { orderId: string; itemIds: readonly string[]; reason: RefundReason; balanceChecked?: boolean },
): Promise<RefundTotals> {
	const plan = await planCatalogRefund(deps, input);
	if (!plan) return NOTHING;
	if (input.reason === 'seller-refund' && !input.balanceChecked) {
		const balance = await deps.sellerBalance();
		const needed = sumOf(plan.planned.map((item) => item.sellerCents)) + sumOf(plan.owed.map((item) => item.cents));
		const short = needed - (balance.availableCents + balance.pendingCents);
		if (short > 0) throw new SellerBalanceShortError(plan.orderId, short);
	}

	const metadata = { catalogOrderId: plan.orderId, reason: input.reason };
	for (const item of plan.planned) {
		const refund = await deps.stripe.createRefund({
			paymentIntentId: plan.paymentIntentId,
			amountCents: item.shopperCents,
			idempotencyKey: `catalog-refund-${item.itemId}`,
			metadata: { ...metadata, catalogItemId: item.itemId },
		});
		// The charge comes before the refunded mark, so a charge that failed is retried with the item's key. The mark comes
		// before the record: it is what keeps a retry from refunding the item again.
		if (item.shortfallCents > 0) await deps.addShortfall({ catalogItemId: item.itemId, amountCents: item.shortfallCents });
		await deps.store.patchItems([{ itemId: item.itemId, status: 'refunded', sellerReversalDueCents: item.sellerCents }]);
		await deps.recordRefund({ catalogItemId: item.itemId, refundId: refund.id, amountCents: item.shopperCents, reason: input.reason });
	}

	const reversals = [...plan.owed, ...plan.planned.filter((item) => item.sellerCents > 0).map((item) => ({ itemId: item.itemId, cents: item.sellerCents }))];
	for (const reversal of reversals) {
		await deps.stripe.createTransferReversal({
			transferId: plan.transferId,
			amountCents: reversal.cents,
			idempotencyKey: `catalog-reversal-${reversal.itemId}`,
			metadata: { ...metadata, catalogItemId: reversal.itemId },
		});
		await deps.store.patchItems([{ itemId: reversal.itemId, sellerReversalDueCents: 0 }]);
	}

	const shopperCents = sumOf(plan.planned.map((item) => item.shopperCents));
	const sellerCents = sumOf(plan.planned.map((item) => item.sellerCents + item.shortfallCents));
	return { refundedItemIds: plan.planned.map((item) => item.itemId), shopperCents, sellerCents, estoriCents: shopperCents - sellerCents };
}
