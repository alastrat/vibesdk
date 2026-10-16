/**
 * A seller refunds lines of a store order, and pays for them. Own lines: the shopper gets the line total back and the
 * seller's transfer gives it back; whatever the transfer can no longer cover becomes a charge on the seller's later
 * sales. Catalog lines go through the catalog refund. Nothing moves unless the seller's Stripe balance covers the whole
 * request.
 *
 * Each own line is claimed in D1 before Stripe is called, so it is refunded once however many requests ask, and a
 * reversal that failed after its refund is taken on the next request with the first request's keys.
 */

import type { StripeClient, StripePaymentIntent } from '../payments/stripe-client';
import type { StoreRefundInitiator } from '../../../shared/types/store-payments';
import type { StoreOrderView } from './store';

export type RefundLinesResult = { ok: true; refundedCents: number } | { ok: false; reason: 'seller_balance_short'; shortCents: number } | { ok: false; reason: 'nothing_to_refund' };

/** A line's refund as claimed and carried out so far. */
export interface StoreRefundRow {
	lineNo: number;
	requestId: string;
	amountCents: number;
	/** What the seller's transfer gives back for the line; the rest is a charge on later sales. */
	reversalCents: number;
	stripeRefundId: string | null;
	reversalId: string | null;
}

export interface RefundLinesDeps {
	stripe: Pick<StripeClient, 'retrievePaymentIntent' | 'createRefund' | 'createTransferReversal'>;
	sellerBalance(): Promise<{ availableCents: number; pendingCents: number }>;
	refundRows(orderId: string): Promise<Map<number, StoreRefundRow>>;
	/** What the catalog refund of these lines would take back from the seller; nothing moves. */
	catalogSellerCents(lineNos: readonly number[]): Promise<number>;
	/** The catalog refund of these lines, with reason 'seller-refund'; the balance was already checked. */
	refundCatalogLines(lineNos: readonly number[]): Promise<{ refundedCents: number }>;
	/** Claims a line, or returns the claim already made for it, possibly by another request. */
	claimRefund(claim: { orderId: string; lineNo: number; requestId: string; initiatedBy: StoreRefundInitiator; amountCents: number; reversalCents: number; now: Date }): Promise<StoreRefundRow>;
	completeRefund(done: { orderId: string; lineNo: number; stripeRefundId: string }): Promise<void>;
	completeReversal(done: { orderId: string; lineNo: number; reversalId: string }): Promise<void>;
	/** A charge, once per line, for the seller share the transfer couldn't cover. */
	addShortfall(shortfall: { orderId: string; lineNo: number; amountCents: number }): Promise<void>;
	applyRefunds(orderId: string): Promise<void>;
	now(): Date;
}

function transferOf(intent: StripePaymentIntent): { id: string; reversibleCents: number } | null {
	const charge = intent.latest_charge;
	if (typeof charge !== 'object' || charge === null || typeof charge.transfer !== 'object' || charge.transfer === null) return null;
	return { id: charge.transfer.id, reversibleCents: charge.transfer.amount - charge.transfer.amount_reversed };
}

const isFinished = (row: StoreRefundRow): boolean => row.stripeRefundId !== null && (row.reversalCents === 0 || row.reversalId !== null);

export async function refundStoreLines(deps: RefundLinesDeps, input: { order: StoreOrderView; lineNos: readonly number[]; requestId: string }): Promise<RefundLinesResult> {
	const { order } = input;
	const paymentIntentId = order.stripePaymentIntentId;
	if (!paymentIntentId) return { ok: false, reason: 'nothing_to_refund' };
	const rows = await deps.refundRows(order.id);
	const requested = order.items.filter((item) => input.lineNos.includes(item.lineNo));
	const catalogNew = requested.filter((item) => item.kind === 'catalog' && !rows.has(item.lineNo)).map((item) => item.lineNo);
	const ownNew = requested.filter((item) => item.kind === 'own' && !rows.has(item.lineNo));
	const ownResumed = requested.flatMap((item) => {
		const row = rows.get(item.lineNo);
		return item.kind === 'own' && row && !isFinished(row) ? [row] : [];
	});
	if (catalogNew.length + ownNew.length + ownResumed.length === 0) return { ok: false, reason: 'nothing_to_refund' };

	// New work only: a resumed line's shopper was already refunded, so its reversal is owed whatever the balance.
	const needed = ownNew.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0) + (catalogNew.length > 0 ? await deps.catalogSellerCents(catalogNew) : 0);
	if (needed > 0) {
		const balance = await deps.sellerBalance();
		const short = needed - (balance.availableCents + balance.pendingCents);
		if (short > 0) return { ok: false, reason: 'seller_balance_short', shortCents: short };
	}

	let refundedCents = 0;
	if (catalogNew.length > 0) refundedCents += (await deps.refundCatalogLines(catalogNew)).refundedCents;

	if (ownNew.length + ownResumed.length > 0) {
		// Read the transfer after the catalog refund drew on it; reversals claimed but not sent are already promised.
		const transfer = transferOf(await deps.stripe.retrievePaymentIntent(paymentIntentId));
		if (!transfer) throw new Error(`Store order ${order.id} has no transfer to take the refund back from`);
		let reversible = transfer.reversibleCents - ownResumed.filter((row) => !row.reversalId).reduce((sum, row) => sum + row.reversalCents, 0);
		const pending: StoreRefundRow[] = [...ownResumed];
		for (const item of ownNew) {
			const amountCents = item.unitPriceCents * item.quantity;
			const reversalCents = Math.min(amountCents, Math.max(reversible, 0));
			// The first request to claim the line keeps it; a later one finishes that claim with its keys.
			const row = await deps.claimRefund({ orderId: order.id, lineNo: item.lineNo, requestId: input.requestId, initiatedBy: 'seller', amountCents, reversalCents, now: deps.now() });
			reversible -= row.reversalCents;
			if (!isFinished(row)) pending.push(row);
		}
		const metadata = { storeOrderId: order.id };
		for (const row of pending) {
			if (!row.stripeRefundId) {
				const refund = await deps.stripe.createRefund({ paymentIntentId, amountCents: row.amountCents, idempotencyKey: `store-refund-${row.requestId}-${row.lineNo}`, metadata: { ...metadata, refundRequestId: row.requestId } });
				// Charged before the refund is marked done, so a charge that failed is retried with the refund's key.
				if (row.amountCents > row.reversalCents) await deps.addShortfall({ orderId: order.id, lineNo: row.lineNo, amountCents: row.amountCents - row.reversalCents });
				await deps.completeRefund({ orderId: order.id, lineNo: row.lineNo, stripeRefundId: refund.id });
				refundedCents += row.amountCents;
			}
			if (row.reversalCents > 0 && !row.reversalId) {
				const reversal = await deps.stripe.createTransferReversal({ transferId: transfer.id, amountCents: row.reversalCents, idempotencyKey: `store-reversal-${row.requestId}-${row.lineNo}`, metadata: { ...metadata, refundRequestId: row.requestId } });
				await deps.completeReversal({ orderId: order.id, lineNo: row.lineNo, reversalId: reversal.id });
			}
		}
	}
	await deps.applyRefunds(order.id);
	return { ok: true, refundedCents };
}
