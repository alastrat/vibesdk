/**
 * A shopper disputes a store payment. For a chargeback Stripe takes the amount and its fee from Estori, so Estori takes
 * the amount back from the seller's transfer, charges the fee to the seller, and holds catalog items not yet bought.
 * An inquiry takes nothing until it becomes a chargeback. A won dispute returns what was taken and releases the items;
 * a lost one keeps it and returns the catalog price of items Estori never bought.
 *
 * Every money move is planned in D1 before Stripe is called and reused on any retry, so a redelivered or parallel event
 * never moves money twice.
 */

import { StripeApiError, type StripeClient } from '../payments/stripe-client';
import type { PlatformAlert } from '../alerts/platform-alerts';
import type { DisputeReversalState, SellerChargeKind, StorePaymentStatus } from '../../../shared/types/store-payments';

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

export interface StoredDispute {
	status: string;
	reversalState: DisputeReversalState;
	reversedCents: number;
	feeCents: number;
	returnedCents: number;
}

export interface DisputeDeps {
	findOrder(paymentIntentId: string): Promise<{ id: string; sellerUserId: string; sellerStripeAccountId: string; checkoutSessionId: string | null } | null>;
	stripe: Pick<StripeClient, 'retrievePaymentIntent' | 'createTransferReversal' | 'createTransfer'>;
	storedDispute(disputeId: string): Promise<StoredDispute | null>;
	saveDispute(row: { id: string; orderId: string; amountCents: number; reason: string; status: string; reversalState: DisputeReversalState; reversalId: string | null; reversedCents: number; feeCents: number; returnedCents: number; now: Date }): Promise<void>;
	/** Adds a charge once per kind and source; a second add changes nothing. */
	addCharge(charge: { sellerUserId: string; kind: SellerChargeKind; sourceId: string; amountCents: number; now: Date }): Promise<void>;
	/** Sets a charge's amount, creating it when missing, and returns what was already collected for it. */
	setCharge(charge: { sellerUserId: string; kind: SellerChargeKind; sourceId: string; amountCents: number; now: Date }): Promise<number>;
	withholdCatalog(checkoutSessionId: string): Promise<void>;
	/** Puts withheld items back to be bought and shipped. */
	releaseCatalog(checkoutSessionId: string): Promise<void>;
	/** The catalog price of withheld items: what Estori kept for goods it never bought. */
	withheldCatalogCents(checkoutSessionId: string): Promise<number>;
	setOrderStatus(status: StorePaymentStatus): Promise<void>;
	/** Sets the order back to paid, or to its refund status when refunds were made. */
	recomputeOrderStatus(): Promise<void>;
	alert(alert: PlatformAlert): Promise<void>;
	now(): Date;
}

const CLOSED_STATUSES = ['won', 'lost', 'warning_closed'];

const feeOf = (dispute: StripeDispute): number => Math.max(dispute.balance_transactions.reduce((sum, entry) => sum + entry.fee, 0), 0);
const isInquiry = (status: string): boolean => status.startsWith('warning_');

/** A refusal Stripe won't change on a retry; a conflict, a rate limit or an outage is retried by redelivery. */
function isRefusal(error: unknown): boolean {
	return error instanceof StripeApiError && error.status >= 400 && error.status < 500 && error.status !== 409 && error.status !== 429 && error.type !== 'idempotency_error';
}

function transferOf(intent: Awaited<ReturnType<StripeClient['retrievePaymentIntent']>>): { id: string; reversibleCents: number } | null {
	const charge = intent.latest_charge;
	if (typeof charge !== 'object' || charge === null || typeof charge.transfer !== 'object' || charge.transfer === null) return null;
	return { id: charge.transfer.id, reversibleCents: charge.transfer.amount - charge.transfer.amount_reversed };
}

export async function handleDisputeOpened(deps: DisputeDeps, dispute: StripeDispute): Promise<'recorded' | 'not-ours'> {
	if (!dispute.payment_intent) return 'not-ours';
	const order = await deps.findOrder(dispute.payment_intent);
	if (!order) return 'not-ours';
	const now = deps.now();
	const stored = await deps.storedDispute(dispute.id);
	const base = { id: dispute.id, orderId: order.id, amountCents: dispute.amount, reason: dispute.reason, status: dispute.status, now };

	if (isInquiry(dispute.status)) {
		await deps.saveDispute({ ...base, reversalState: stored?.reversalState ?? 'none', reversalId: null, reversedCents: stored?.reversedCents ?? 0, feeCents: stored?.feeCents ?? 0, returnedCents: stored?.returnedCents ?? 0 });
		if (!stored) await deps.alert({ kind: 'dispute-opened', subject: order.id, message: `A shopper's bank asked about ${(dispute.amount / 100).toFixed(2)} USD (${dispute.reason}). Nothing was taken yet; answer it in the Stripe Dashboard.` });
		return 'recorded';
	}

	// A chargeback: plan the reversal once, from the transfer as it was before it, and reuse that plan on every retry.
	let state: DisputeReversalState = stored?.reversalState ?? 'none';
	let reversedCents = stored?.reversedCents ?? 0;
	let reversalId: string | null = null;
	const transfer = state === 'none' || state === 'planned' ? transferOf(await deps.stripe.retrievePaymentIntent(dispute.payment_intent)) : null;
	if (state === 'none') {
		reversedCents = transfer ? Math.min(dispute.amount, Math.max(transfer.reversibleCents, 0)) : 0;
		state = reversedCents > 0 ? 'planned' : 'refused';
		await deps.saveDispute({ ...base, reversalState: state, reversalId: null, reversedCents, feeCents: stored?.feeCents ?? 0, returnedCents: 0 });
	}
	if (state === 'planned' && transfer) {
		try {
			reversalId = (await deps.stripe.createTransferReversal({ transferId: transfer.id, amountCents: reversedCents, idempotencyKey: `dispute-reversal-${dispute.id}`, metadata: { disputeId: dispute.id, storeOrderId: order.id } })).id;
			state = 'done';
		} catch (error) {
			if (!isRefusal(error)) throw error;
			state = 'refused';
			reversedCents = 0;
		}
	}

	const feeCents = feeOf(dispute);
	if (feeCents > 0) await deps.addCharge({ sellerUserId: order.sellerUserId, kind: 'dispute-fee', sourceId: dispute.id, amountCents: feeCents, now });
	if (dispute.amount > reversedCents) await deps.addCharge({ sellerUserId: order.sellerUserId, kind: 'dispute-shortfall', sourceId: dispute.id, amountCents: dispute.amount - reversedCents, now });
	if (order.checkoutSessionId) await deps.withholdCatalog(order.checkoutSessionId);
	await deps.setOrderStatus('disputed');
	await deps.saveDispute({ ...base, reversalState: state, reversalId, reversedCents, feeCents, returnedCents: stored?.returnedCents ?? 0 });
	if (!stored || stored.reversalState === 'none') {
		await deps.alert({ kind: 'dispute-opened', subject: order.id, message: `A shopper disputed ${(dispute.amount / 100).toFixed(2)} USD (${dispute.reason}). Answer it in the Stripe Dashboard.` });
	}
	return 'recorded';
}

export async function handleDisputeClosed(deps: DisputeDeps, dispute: StripeDispute): Promise<'won' | 'lost' | 'inquiry-closed' | 'not-ours'> {
	if (!dispute.payment_intent) return 'not-ours';
	const order = await deps.findOrder(dispute.payment_intent);
	const stored = await deps.storedDispute(dispute.id);
	if (!order || !stored) return 'not-ours';
	const outcome = dispute.status === 'won' ? 'won' : dispute.status === 'warning_closed' ? 'inquiry-closed' : 'lost';
	// Already closed: a late redelivery never pays anyone twice, whatever Stripe kept of its idempotency keys.
	if (CLOSED_STATUSES.includes(stored.status)) return outcome;
	const now = deps.now();
	const feeCents = feeOf(dispute);
	const charge = (kind: SellerChargeKind, amountCents: number) => deps.setCharge({ sellerUserId: order.sellerUserId, kind, sourceId: dispute.id, amountCents, now });
	const giveBack = async (amountCents: number, key: string): Promise<number> => {
		if (amountCents <= 0) return 0;
		await deps.stripe.createTransfer({ destination: order.sellerStripeAccountId, amountCents, idempotencyKey: `${key}-${dispute.id}`, metadata: { disputeId: dispute.id, storeOrderId: order.id } });
		return amountCents;
	};
	let returnedCents = 0;
	let message: string;

	if (outcome === 'inquiry-closed') {
		await deps.recomputeOrderStatus();
		message = 'The inquiry closed without a chargeback; nothing was owed.';
	} else if (outcome === 'won') {
		if (stored.reversalState === 'done') returnedCents += await giveBack(stored.reversedCents, 'dispute-return');
		// Stripe returned the whole amount, so the shortfall the seller owed is cancelled and what they paid of it comes back.
		returnedCents += await giveBack(await charge('dispute-shortfall', 0), 'dispute-shortfall-return');
		returnedCents += await giveBack((await charge('dispute-fee', feeCents)) - feeCents, 'dispute-fee-return');
		if (order.checkoutSessionId) await deps.releaseCatalog(order.checkoutSessionId);
		await deps.recomputeOrderStatus();
		message = 'The dispute was decided for the seller; what was taken back was returned.';
	} else {
		// The fee is what Stripe kept, including a countered fee charged when evidence was sent.
		returnedCents += await giveBack((await charge('dispute-fee', feeCents)) - feeCents, 'dispute-fee-return');
		if (order.checkoutSessionId) returnedCents += await giveBack(await deps.withheldCatalogCents(order.checkoutSessionId), 'dispute-withheld');
		await deps.setOrderStatus('dispute_lost');
		message = 'The dispute was lost; the seller pays the amount and the fee.';
	}
	await deps.saveDispute({ id: dispute.id, orderId: order.id, amountCents: dispute.amount, reason: dispute.reason, status: dispute.status, reversalState: stored.reversalState, reversalId: null, reversedCents: stored.reversedCents, feeCents, returnedCents: stored.returnedCents + returnedCents, now });
	await deps.alert({ kind: 'dispute-closed', subject: order.id, message });
	return outcome;
}
