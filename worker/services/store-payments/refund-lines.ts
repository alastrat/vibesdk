/**
 * A seller refunds lines of a store order. Own lines: the shopper gets the line total back and the seller's transfer
 * gives it back. Catalog lines go through the catalog refund. Nothing moves unless the seller's Stripe balance covers it.
 */

import type { StripeClient, StripePaymentIntent } from '../payments/stripe-client';
import type { StoreRefundInitiator } from '../../../shared/types/store-payments';
import type { StoreOrderView } from './store';

export type RefundLinesResult = { ok: true; refundedCents: number } | { ok: false; reason: 'seller_balance_short'; shortCents: number } | { ok: false; reason: 'nothing_to_refund' };

export interface RefundLinesDeps {
	stripe: Pick<StripeClient, 'retrievePaymentIntent' | 'createRefund' | 'createTransferReversal'>;
	sellerBalance(): Promise<{ availableCents: number; pendingCents: number }>;
	refundedLines(orderId: string): Promise<Set<number>>;
	/** The catalog refund for these lines, with reason 'seller-refund'; it checks the balance itself. */
	refundCatalogLines(lineNos: readonly number[]): Promise<RefundLinesResult>;
	recordRefund(entry: { refundId: string; orderId: string; lineNo: number; amountCents: number; requestId: string; initiatedBy: StoreRefundInitiator; now: Date }): Promise<void>;
	applyRefunds(orderId: string): Promise<void>;
	now(): Date;
}

function transferIdOf(intent: StripePaymentIntent): string | null {
	const charge = intent.latest_charge;
	if (typeof charge !== 'object' || charge === null) return null;
	return typeof charge.transfer === 'object' && charge.transfer !== null ? charge.transfer.id : null;
}

export async function refundStoreLines(deps: RefundLinesDeps, input: { order: StoreOrderView; lineNos: readonly number[]; requestId: string }): Promise<RefundLinesResult> {
	const done = await deps.refundedLines(input.order.id);
	const lines = input.order.items.filter((item) => input.lineNos.includes(item.lineNo) && !done.has(item.lineNo));
	if (lines.length === 0 || !input.order.stripePaymentIntentId) return { ok: false, reason: 'nothing_to_refund' };
	const own = lines.filter((item) => item.kind === 'own');
	const catalog = lines.filter((item) => item.kind === 'catalog');

	const ownCents = own.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
	if (own.length > 0) {
		const balance = await deps.sellerBalance();
		const short = ownCents - (balance.availableCents + balance.pendingCents);
		if (short > 0) return { ok: false, reason: 'seller_balance_short', shortCents: short };
	}

	let refundedCents = 0;
	if (catalog.length > 0) {
		const result = await deps.refundCatalogLines(catalog.map((item) => item.lineNo));
		if (!result.ok) return result;
		refundedCents += result.refundedCents;
	}
	if (own.length > 0) {
		const transferId = transferIdOf(await deps.stripe.retrievePaymentIntent(input.order.stripePaymentIntentId));
		if (!transferId) throw new Error(`Store order ${input.order.id} has no transfer to take the refund back from`);
		const metadata = { storeOrderId: input.order.id, refundRequestId: input.requestId };
		for (const line of own) {
			const amount = line.unitPriceCents * line.quantity;
			const refund = await deps.stripe.createRefund({ paymentIntentId: input.order.stripePaymentIntentId, amountCents: amount, idempotencyKey: `store-refund-${input.requestId}-${line.lineNo}`, metadata });
			await deps.recordRefund({ refundId: refund.id, orderId: input.order.id, lineNo: line.lineNo, amountCents: amount, requestId: input.requestId, initiatedBy: 'seller', now: deps.now() });
			await deps.stripe.createTransferReversal({ transferId, amountCents: amount, idempotencyKey: `store-reversal-${input.requestId}-${line.lineNo}`, metadata });
			refundedCents += amount;
		}
	}
	await deps.applyRefunds(input.order.id);
	return { ok: true, refundedCents };
}
