/**
 * After a store sale is recorded: take back any card fee above what the sale collected, then the seller's open
 * charges, all from this sale's transfer and never past the seller's share of it. Safe to run again: each reversal
 * has a stable key, and the fee adjustment is recorded once per order.
 */

import { processingFeeCents } from '../../../shared/types/catalog';
import type { StripeClient, StripePaymentIntent } from '../payments/stripe-client';

export interface SettleOrder {
	id: string;
	sellerUserId: string;
	paymentIntentId: string;
	totalCents: number;
	applicationFeeCents: number;
}

export interface SettleSaleDeps {
	stripe: Pick<StripeClient, 'retrievePaymentIntent' | 'createTransferReversal'>;
	feeAdjusted(orderId: string): Promise<boolean>;
	recordFeeAdjustment(adjustment: { orderId: string; collectedCents: number; actualFeeCents: number; reversalId: string | null; now: Date }): Promise<void>;
	openCharges(sellerUserId: string): Promise<Array<{ id: string; amountCents: number; collectedCents: number }>>;
	recordCollection(collection: { chargeId: string; orderId: string; reversalId: string; amountCents: number; now: Date }): Promise<void>;
	now(): Date;
}

function chargeOf(intent: StripePaymentIntent): { transferId: string; reversibleCents: number; feeCents: number | null } | null {
	const charge = intent.latest_charge;
	if (typeof charge !== 'object' || charge === null) return null;
	const transfer = charge.transfer;
	if (typeof transfer !== 'object' || transfer === null) return null;
	const balance = charge.balance_transaction;
	return {
		transferId: transfer.id,
		reversibleCents: transfer.amount - transfer.amount_reversed,
		feeCents: typeof balance === 'object' && balance !== null ? balance.fee : null,
	};
}

export async function settleSale(deps: SettleSaleDeps, order: SettleOrder): Promise<{ feeDifferenceCents: number; collectedCents: number }> {
	const charge = chargeOf(await deps.stripe.retrievePaymentIntent(order.paymentIntentId));
	if (!charge) return { feeDifferenceCents: 0, collectedCents: 0 };
	// The seller's share left in this sale: the transfer is the whole charge, and Estori's fee was taken from it.
	let sellerShare = charge.reversibleCents - order.applicationFeeCents;
	const metadata = { storeOrderId: order.id };

	let feeDifferenceCents = 0;
	if (charge.feeCents !== null && !(await deps.feeAdjusted(order.id))) {
		const collectedCents = processingFeeCents(order.totalCents);
		const difference = Math.min(Math.max(charge.feeCents - collectedCents, 0), Math.max(sellerShare, 0));
		let reversalId: string | null = null;
		if (difference > 0) {
			const reversal = await deps.stripe.createTransferReversal({ transferId: charge.transferId, amountCents: difference, idempotencyKey: `fee-difference-${order.id}`, metadata });
			reversalId = reversal.id;
			sellerShare -= difference;
			feeDifferenceCents = difference;
		}
		await deps.recordFeeAdjustment({ orderId: order.id, collectedCents, actualFeeCents: charge.feeCents, reversalId, now: deps.now() });
	}

	let collectedCents = 0;
	for (const open of await deps.openCharges(order.sellerUserId)) {
		if (sellerShare <= 0) break;
		const amount = Math.min(open.amountCents - open.collectedCents, sellerShare);
		if (amount <= 0) continue;
		const reversal = await deps.stripe.createTransferReversal({
			transferId: charge.transferId,
			amountCents: amount,
			idempotencyKey: `seller-charge-${open.id}-${order.id}`,
			metadata: { ...metadata, sellerChargeId: open.id },
		});
		await deps.recordCollection({ chargeId: open.id, orderId: order.id, reversalId: reversal.id, amountCents: amount, now: deps.now() });
		sellerShare -= amount;
		collectedCents += amount;
	}
	return { feeDifferenceCents, collectedCents };
}
