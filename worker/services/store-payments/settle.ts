/**
 * After a store sale is recorded: take back any card fee above what the sale collected, then the seller's open
 * charges, all from this sale's transfer and never past the seller's share of it.
 *
 * Each move is written to D1 before Stripe is called: the fee difference as a plan, each collection as a claim that
 * only succeeds while the charge is still owed. A retry reuses the stored amount and key, and two sales settling at
 * once can't both collect the same charge.
 */

import { processingFeeCents } from '../../../shared/types/catalog';
import { StripeApiError, type StripeClient, type StripePaymentIntent } from '../payments/stripe-client';

export interface SettleOrder {
	id: string;
	sellerUserId: string;
	paymentIntentId: string;
	totalCents: number;
	applicationFeeCents: number;
}

export interface SettleSaleDeps {
	stripe: Pick<StripeClient, 'retrievePaymentIntent' | 'createTransferReversal'>;
	feeAdjustment(orderId: string): Promise<{ differenceCents: number; reversalId: string | null } | null>;
	/** Saves the difference to take back; a second plan for the order changes nothing. */
	planFeeAdjustment(plan: { orderId: string; collectedCents: number; actualFeeCents: number; differenceCents: number; now: Date }): Promise<void>;
	completeFeeAdjustment(orderId: string, reversalId: string): Promise<void>;
	openCharges(sellerUserId: string): Promise<Array<{ id: string; amountCents: number; collectedCents: number }>>;
	/** This order's claims, finished or not. */
	claims(orderId: string): Promise<Array<{ chargeId: string; amountCents: number; reversalId: string | null }>>;
	/** Claims an amount of a charge for this order only while that much is still owed; true when the claim is this order's. */
	claimCollection(claim: { chargeId: string; orderId: string; amountCents: number; now: Date }): Promise<boolean>;
	completeCollection(done: { chargeId: string; orderId: string; reversalId: string }): Promise<void>;
	releaseClaim(release: { chargeId: string; orderId: string }): Promise<void>;
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

/** A refusal Stripe won't change on a retry, such as too little left to reverse. */
function isRefusal(error: unknown): boolean {
	return error instanceof StripeApiError && error.status >= 400 && error.status < 500 && error.status !== 409 && error.status !== 429 && error.type !== 'idempotency_error';
}

export async function settleSale(deps: SettleSaleDeps, order: SettleOrder): Promise<{ feeDifferenceCents: number; collectedCents: number }> {
	const charge = chargeOf(await deps.stripe.retrievePaymentIntent(order.paymentIntentId));
	if (!charge) return { feeDifferenceCents: 0, collectedCents: 0 };
	const metadata = { storeOrderId: order.id };
	const reverse = async (amountCents: number, idempotencyKey: string, extra: Record<string, string> = {}) =>
		(await deps.stripe.createTransferReversal({ transferId: charge.transferId, amountCents, idempotencyKey, metadata: { ...metadata, ...extra } })).id;

	// The seller's share left in this sale: the transfer is the whole charge, and Estori's fee was taken from it.
	// Moves claimed but not yet sent aren't in the transfer's reversed amount yet, so they come off here.
	const existing = await deps.claims(order.id);
	let sellerShare = charge.reversibleCents - order.applicationFeeCents - existing.filter((claim) => !claim.reversalId).reduce((sum, claim) => sum + claim.amountCents, 0);

	let feeDifferenceCents = 0;
	let adjustment = await deps.feeAdjustment(order.id);
	if (!adjustment && charge.feeCents !== null) {
		const collectedCents = processingFeeCents(order.totalCents);
		const differenceCents = Math.min(Math.max(charge.feeCents - collectedCents, 0), Math.max(sellerShare, 0));
		await deps.planFeeAdjustment({ orderId: order.id, collectedCents, actualFeeCents: charge.feeCents, differenceCents, now: deps.now() });
		adjustment = (await deps.feeAdjustment(order.id)) ?? { differenceCents, reversalId: null };
	}
	if (adjustment && adjustment.differenceCents > 0 && !adjustment.reversalId) {
		sellerShare -= adjustment.differenceCents;
		await deps.completeFeeAdjustment(order.id, await reverse(adjustment.differenceCents, `fee-difference-${order.id}`));
		feeDifferenceCents = adjustment.differenceCents;
	}

	let collectedCents = 0;
	// First finish what this order claimed before a crash, with the claimed amount and key.
	for (const claim of existing.filter((made) => !made.reversalId)) {
		const reversalId = await reverse(claim.amountCents, `seller-charge-${claim.chargeId}-${order.id}`, { sellerChargeId: claim.chargeId });
		await deps.completeCollection({ chargeId: claim.chargeId, orderId: order.id, reversalId });
		collectedCents += claim.amountCents;
	}
	const claimed = new Set(existing.map((claim) => claim.chargeId));
	for (const open of await deps.openCharges(order.sellerUserId)) {
		if (sellerShare <= 0) break;
		if (claimed.has(open.id)) continue;
		const amount = Math.min(open.amountCents - open.collectedCents, sellerShare);
		if (amount <= 0) continue;
		// Another sale collecting the same charge at the same time loses this claim and moves on.
		if (!(await deps.claimCollection({ chargeId: open.id, orderId: order.id, amountCents: amount, now: deps.now() }))) continue;
		let reversalId: string;
		try {
			reversalId = await reverse(amount, `seller-charge-${open.id}-${order.id}`, { sellerChargeId: open.id });
		} catch (error) {
			if (!isRefusal(error)) throw error;
			// Stripe won't take it from this sale: give the claim back for a later sale, and stop collecting here.
			await deps.releaseClaim({ chargeId: open.id, orderId: order.id });
			break;
		}
		await deps.completeCollection({ chargeId: open.id, orderId: order.id, reversalId });
		sellerShare -= amount;
		collectedCents += amount;
	}
	return { feeDifferenceCents, collectedCents };
}

/** The parts of a Stripe charge that say whether the seller's transfer exists yet. */
export interface StripeChargeTransfer {
	id: string;
	object: 'charge';
	payment_intent: string | null;
	transfer: string | null;
}

export function isStripeChargeTransfer(value: unknown): value is StripeChargeTransfer {
	if (typeof value !== 'object' || value === null) return false;
	const charge = value as Record<string, unknown>;
	return charge.object === 'charge' && typeof charge.id === 'string';
}

/**
 * Stripe creates a store sale's transfer a few seconds after the payment, so the order is usually recorded before there
 * is anything to take back from. The sale settles again when its charge gains the transfer; settling is safe to repeat.
 */
export async function settleOnTransfer(
	deps: { orderIdForPaymentIntent(paymentIntentId: string): Promise<string | null>; settleSale(orderId: string): Promise<void> },
	charge: StripeChargeTransfer,
): Promise<'settled' | 'no-transfer' | 'not-a-store-sale'> {
	if (typeof charge.transfer !== 'string' || typeof charge.payment_intent !== 'string') return 'no-transfer';
	const orderId = await deps.orderIdForPaymentIntent(charge.payment_intent);
	if (!orderId) return 'not-a-store-sale';
	await deps.settleSale(orderId);
	return 'settled';
}

