/**
 * A shopper disputes a store payment: Stripe takes the amount and its fee from Estori, so Estori takes the amount back
 * from the seller's transfer at once, charges the fee to the seller, and holds catalog items not yet bought. A won
 * dispute returns what was taken, and the fee if Stripe returned it.
 */

import type { StripeClient } from '../payments/stripe-client';
import type { PlatformAlert } from '../alerts/platform-alerts';
import type { SellerChargeKind, StorePaymentStatus } from '../../../shared/types/store-payments';

export interface StripeDispute {
	id: string;
	amount: number;
	charge: string;
	payment_intent: string | null;
	reason: string;
	status: string;
	balance_transactions: Array<{ fee: number }>;
}

export function isStripeDispute(object: unknown): object is StripeDispute {
	if (typeof object !== 'object' || object === null) return false;
	const candidate = object as Partial<StripeDispute>;
	return typeof candidate.id === 'string' && candidate.id.startsWith('dp_') && typeof candidate.amount === 'number' && Array.isArray(candidate.balance_transactions);
}

export interface DisputeDeps {
	findOrder(paymentIntentId: string): Promise<{ id: string; sellerUserId: string; sellerStripeAccountId: string; checkoutSessionId: string | null } | null>;
	stripe: Pick<StripeClient, 'retrievePaymentIntent' | 'createTransferReversal' | 'createTransfer'>;
	storedDispute(disputeId: string): Promise<{ reversedCents: number; feeCents: number } | null>;
	saveDispute(row: { id: string; orderId: string; amountCents: number; reason: string; status: string; reversalId: string | null; reversedCents: number; feeCents: number; returnedCents: number; now: Date }): Promise<void>;
	addCharge(charge: { sellerUserId: string; kind: SellerChargeKind; sourceId: string; amountCents: number; now: Date }): Promise<void>;
	/** Sets the dispute-fee charge to this amount; a collected excess is paid back by the caller's transfer. */
	setFeeCharge(amountCents: number): Promise<void>;
	withholdCatalog(checkoutSessionId: string): Promise<void>;
	setOrderStatus(status: StorePaymentStatus): Promise<void>;
	alert(alert: PlatformAlert): Promise<void>;
	now(): Date;
}

const feeOf = (dispute: StripeDispute): number => Math.max(dispute.balance_transactions.reduce((sum, entry) => sum + entry.fee, 0), 0);

export async function handleDisputeOpened(deps: DisputeDeps, dispute: StripeDispute): Promise<'recorded' | 'not-ours'> {
	if (!dispute.payment_intent) return 'not-ours';
	const order = await deps.findOrder(dispute.payment_intent);
	if (!order) return 'not-ours';
	const now = deps.now();
	const charge = (await deps.stripe.retrievePaymentIntent(dispute.payment_intent)).latest_charge;
	const transfer = typeof charge === 'object' && charge !== null && typeof charge.transfer === 'object' ? charge.transfer : null;
	const reversible = transfer ? transfer.amount - transfer.amount_reversed : 0;
	let reversedCents = Math.min(dispute.amount, Math.max(reversible, 0));
	let reversalId: string | null = null;
	if (transfer && reversedCents > 0) {
		try {
			reversalId = (await deps.stripe.createTransferReversal({ transferId: transfer.id, amountCents: reversedCents, idempotencyKey: `dispute-reversal-${dispute.id}`, metadata: { disputeId: dispute.id, storeOrderId: order.id } })).id;
		} catch {
			reversedCents = 0;
		}
	}
	const feeCents = feeOf(dispute);
	if (feeCents > 0) await deps.addCharge({ sellerUserId: order.sellerUserId, kind: 'dispute-fee', sourceId: dispute.id, amountCents: feeCents, now });
	if (dispute.amount > reversedCents) await deps.addCharge({ sellerUserId: order.sellerUserId, kind: 'dispute-shortfall', sourceId: dispute.id, amountCents: dispute.amount - reversedCents, now });
	if (order.checkoutSessionId) await deps.withholdCatalog(order.checkoutSessionId);
	await deps.setOrderStatus('disputed');
	await deps.saveDispute({ id: dispute.id, orderId: order.id, amountCents: dispute.amount, reason: dispute.reason, status: dispute.status, reversalId, reversedCents, feeCents, returnedCents: 0, now });
	await deps.alert({ kind: 'dispute-opened', subject: order.id, message: `A shopper disputed ${(dispute.amount / 100).toFixed(2)} USD (${dispute.reason}). Answer it in the Stripe Dashboard.` });
	return 'recorded';
}

export async function handleDisputeClosed(deps: DisputeDeps, dispute: StripeDispute): Promise<'won' | 'lost' | 'not-ours'> {
	if (!dispute.payment_intent) return 'not-ours';
	const order = await deps.findOrder(dispute.payment_intent);
	const stored = await deps.storedDispute(dispute.id);
	if (!order || !stored) return 'not-ours';
	const now = deps.now();
	const won = dispute.status === 'won';
	const feeCents = feeOf(dispute);
	let returnedCents = 0;
	if (won && stored.reversedCents > 0) {
		await deps.stripe.createTransfer({ destination: order.sellerStripeAccountId, amountCents: stored.reversedCents, idempotencyKey: `dispute-return-${dispute.id}`, metadata: { disputeId: dispute.id, storeOrderId: order.id } });
		returnedCents = stored.reversedCents;
	}
	if (feeCents < stored.feeCents) await deps.setFeeCharge(feeCents);
	await deps.setOrderStatus(won ? 'paid' : 'dispute_lost');
	await deps.saveDispute({ id: dispute.id, orderId: order.id, amountCents: dispute.amount, reason: dispute.reason, status: dispute.status, reversalId: null, reversedCents: stored.reversedCents, feeCents, returnedCents, now });
	await deps.alert({ kind: 'dispute-closed', subject: order.id, message: won ? 'The dispute was decided for the seller; what was taken back was returned.' : 'The dispute was lost; the seller keeps paying the amount and the fee.' });
	return won ? 'won' : 'lost';
}
