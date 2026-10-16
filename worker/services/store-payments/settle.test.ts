import { describe, expect, it } from 'vitest';
import { settleSale, type SettleSaleDeps, type SettleOrder } from './settle';
import { StripeApiError } from '../payments/stripe-client';

const ORDER: SettleOrder = { id: 'ord_1', sellerUserId: 'u1', paymentIntentId: 'pi_1', totalCents: 4099, applicationFeeCents: 2177 };
const OTHER: SettleOrder = { ...ORDER, id: 'ord_2', paymentIntentId: 'pi_2' };

/** D1 and Stripe in memory, shared by every sale settled against it. */
function world(input: { fee?: number; reversed?: number; charges?: Array<{ id: string; amountCents: number }>; refuse?: boolean } = {}) {
	const reversals: Array<{ amountCents: number; idempotencyKey: string }> = [];
	const reversedByTransfer = new Map<string, number>([['tr_1', input.reversed ?? 0], ['tr_2', 0]]);
	const adjustments = new Map<string, { differenceCents: number; reversalId: string | null }>();
	const charges = new Map((input.charges ?? []).map((charge) => [charge.id, charge.amountCents]));
	const claims: Array<{ chargeId: string; orderId: string; amountCents: number; reversalId: string | null }> = [];
	const collected = (chargeId: string) => claims.filter((claim) => claim.chargeId === chargeId).reduce((sum, claim) => sum + claim.amountCents, 0);
	const deps: SettleSaleDeps = {
		stripe: {
			retrievePaymentIntent: async (id) => {
				const transferId = id === 'pi_1' ? 'tr_1' : 'tr_2';
				return { id, latest_charge: { id: 'ch', transfer: { id: transferId, amount: 4099, amount_reversed: reversedByTransfer.get(transferId) ?? 0 }, balance_transaction: { id: 'txn', fee: input.fee ?? 149 } } };
			},
			createTransferReversal: async (reversal) => {
				if (input.refuse) throw new StripeApiError('Insufficient funds', 400, 'insufficient_funds', 'invalid_request_error');
				if (!reversals.some((made) => made.idempotencyKey === reversal.idempotencyKey)) {
					reversals.push({ amountCents: reversal.amountCents, idempotencyKey: reversal.idempotencyKey });
					reversedByTransfer.set(reversal.transferId, (reversedByTransfer.get(reversal.transferId) ?? 0) + reversal.amountCents);
				}
				return { id: `trr_${reversal.idempotencyKey}`, amount: reversal.amountCents };
			},
		},
		feeAdjustment: async (orderId) => adjustments.get(orderId) ?? null,
		planFeeAdjustment: async (plan) => {
			if (!adjustments.has(plan.orderId)) adjustments.set(plan.orderId, { differenceCents: plan.differenceCents, reversalId: null });
		},
		completeFeeAdjustment: async (orderId, reversalId) => {
			const adjustment = adjustments.get(orderId);
			if (adjustment) adjustments.set(orderId, { ...adjustment, reversalId });
		},
		openCharges: async () => [...charges.entries()].map(([id, amountCents]) => ({ id, amountCents, collectedCents: collected(id) })).filter((charge) => charge.collectedCents < charge.amountCents),
		claims: async (orderId) => claims.filter((claim) => claim.orderId === orderId),
		// Atomic, as one D1 statement: claims only what is still owed.
		claimCollection: async (claim) => {
			if (claims.some((made) => made.chargeId === claim.chargeId && made.orderId === claim.orderId)) return true;
			if ((charges.get(claim.chargeId) ?? 0) - collected(claim.chargeId) < claim.amountCents) return false;
			claims.push({ chargeId: claim.chargeId, orderId: claim.orderId, amountCents: claim.amountCents, reversalId: null });
			return true;
		},
		completeCollection: async (done) => {
			const claim = claims.find((made) => made.chargeId === done.chargeId && made.orderId === done.orderId);
			if (claim) claim.reversalId = done.reversalId;
		},
		releaseClaim: async (release) => {
			const index = claims.findIndex((made) => made.chargeId === release.chargeId && made.orderId === release.orderId);
			if (index >= 0) claims.splice(index, 1);
		},
		now: () => new Date(0),
	};
	return { deps, reversals, adjustments, claims, collected };
}

describe('settleSale', () => {
	it('takes nothing when the card cost what the sale collected and nothing is owed', async () => {
		const { deps, reversals, adjustments } = world();
		expect(await settleSale(deps, ORDER)).toEqual({ feeDifferenceCents: 0, collectedCents: 0 });
		expect(reversals).toEqual([]);
		expect(adjustments.get('ord_1')).toEqual({ differenceCents: 0, reversalId: null });
	});

	it("plans the extra card fee before Stripe, takes it once, and reuses the plan on a retry", async () => {
		const w = world({ fee: 210 });
		expect(await settleSale(w.deps, ORDER)).toEqual({ feeDifferenceCents: 61, collectedCents: 0 });
		expect(await settleSale(w.deps, ORDER)).toEqual({ feeDifferenceCents: 0, collectedCents: 0 });
		expect(w.reversals).toEqual([{ amountCents: 61, idempotencyKey: 'fee-difference-ord_1' }]);
		expect(w.adjustments.get('ord_1')).toEqual({ differenceCents: 61, reversalId: 'trr_fee-difference-ord_1' });
	});

	it('finishes a fee difference planned before a crash with the planned amount', async () => {
		const w = world({ fee: 210 });
		await w.deps.planFeeAdjustment({ orderId: 'ord_1', collectedCents: 149, actualFeeCents: 210, differenceCents: 61, now: new Date(0) });
		expect(await settleSale(w.deps, ORDER)).toEqual({ feeDifferenceCents: 61, collectedCents: 0 });
		expect(w.reversals).toEqual([{ amountCents: 61, idempotencyKey: 'fee-difference-ord_1' }]);
	});

	it("collects open charges oldest first, never past the seller's share of the sale", async () => {
		// Seller's share: 4099 - 2177 = 1922, less 22 already reversed = 1900.
		const w = world({ reversed: 22, charges: [{ id: 'sc_1', amountCents: 1500 }, { id: 'sc_2', amountCents: 800 }] });
		expect(await settleSale(w.deps, ORDER)).toEqual({ feeDifferenceCents: 0, collectedCents: 1900 });
		expect(w.reversals).toEqual([
			{ amountCents: 1500, idempotencyKey: 'seller-charge-sc_1-ord_1' },
			{ amountCents: 400, idempotencyKey: 'seller-charge-sc_2-ord_1' },
		]);
	});

	it('collects a charge once when two sales settle at the same time', async () => {
		const w = world({ charges: [{ id: 'sc_1', amountCents: 275 }] });
		await Promise.all([settleSale(w.deps, ORDER), settleSale(w.deps, OTHER)]);
		expect(w.collected('sc_1')).toBe(275);
		expect(w.reversals.map((reversal) => reversal.amountCents)).toEqual([275]);
	});

	it('finishes a collection claimed before a crash with the claimed amount and key', async () => {
		const w = world({ charges: [{ id: 'sc_1', amountCents: 275 }] });
		await w.deps.claimCollection({ chargeId: 'sc_1', orderId: 'ord_1', amountCents: 275, now: new Date(0) });
		expect(await settleSale(w.deps, ORDER)).toEqual({ feeDifferenceCents: 0, collectedCents: 275 });
		expect(w.reversals).toEqual([{ amountCents: 275, idempotencyKey: 'seller-charge-sc_1-ord_1' }]);
		expect(w.claims).toEqual([{ chargeId: 'sc_1', orderId: 'ord_1', amountCents: 275, reversalId: 'trr_seller-charge-sc_1-ord_1' }]);
	});

	it('gives a claim back when Stripe refuses the reversal, so a later sale collects it', async () => {
		const w = world({ charges: [{ id: 'sc_1', amountCents: 275 }], refuse: true });
		expect(await settleSale(w.deps, ORDER)).toEqual({ feeDifferenceCents: 0, collectedCents: 0 });
		expect(w.claims).toEqual([]);
	});

	it('leaves a sale with no transfer alone', async () => {
		const w = world();
		w.deps.stripe.retrievePaymentIntent = async (id) => ({ id, latest_charge: null });
		expect(await settleSale(w.deps, ORDER)).toEqual({ feeDifferenceCents: 0, collectedCents: 0 });
		expect(w.reversals).toEqual([]);
	});
});
