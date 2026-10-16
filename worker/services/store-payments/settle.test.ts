import { describe, expect, it } from 'vitest';
import { settleSale, type SettleSaleDeps, type SettleOrder } from './settle';

const ORDER: SettleOrder = { id: 'ord_1', sellerUserId: 'u1', paymentIntentId: 'pi_1', totalCents: 4099, applicationFeeCents: 2177 };

function fakeDeps(input: { fee?: number; reversed?: number; charges?: Array<{ id: string; amountCents: number; collectedCents: number }>; adjusted?: boolean } = {}) {
	const reversals: Array<{ amountCents: number; idempotencyKey: string }> = [];
	const collections: Array<{ chargeId: string; amountCents: number }> = [];
	const adjustments: Array<{ collectedCents: number; actualFeeCents: number; reversalId: string | null }> = [];
	const deps: SettleSaleDeps = {
		stripe: {
			retrievePaymentIntent: async (id) => ({
				id,
				latest_charge: { id: 'ch_1', transfer: { id: 'tr_1', amount: 4099, amount_reversed: input.reversed ?? 0 }, balance_transaction: { id: 'txn_1', fee: input.fee ?? 149 } },
			}),
			createTransferReversal: async (reversal) => {
				reversals.push({ amountCents: reversal.amountCents, idempotencyKey: reversal.idempotencyKey });
				return { id: `trr_${reversals.length}`, amount: reversal.amountCents };
			},
		},
		feeAdjusted: async () => input.adjusted ?? false,
		recordFeeAdjustment: async (adjustment) => void adjustments.push({ collectedCents: adjustment.collectedCents, actualFeeCents: adjustment.actualFeeCents, reversalId: adjustment.reversalId }),
		openCharges: async () => input.charges ?? [],
		recordCollection: async (collection) => void collections.push({ chargeId: collection.chargeId, amountCents: collection.amountCents }),
		now: () => new Date(1_800_000_000_000),
	};
	return { deps, reversals, collections, adjustments };
}

describe('settleSale', () => {
	it('takes nothing when the card cost what the sale collected and nothing is owed', async () => {
		const { deps, reversals, adjustments } = fakeDeps();
		expect(await settleSale(deps, ORDER)).toEqual({ feeDifferenceCents: 0, collectedCents: 0 });
		expect(reversals).toEqual([]);
		expect(adjustments).toEqual([{ collectedCents: 149, actualFeeCents: 149, reversalId: null }]);
	});

	it("takes the extra card fee from the seller's share, once", async () => {
		const { deps, reversals, adjustments } = fakeDeps({ fee: 210 });
		expect(await settleSale(deps, ORDER)).toEqual({ feeDifferenceCents: 61, collectedCents: 0 });
		expect(reversals).toEqual([{ amountCents: 61, idempotencyKey: 'fee-difference-ord_1' }]);
		expect(adjustments[0]).toMatchObject({ collectedCents: 149, actualFeeCents: 210, reversalId: 'trr_1' });

		const again = fakeDeps({ fee: 210, adjusted: true });
		expect(await settleSale(again.deps, ORDER)).toEqual({ feeDifferenceCents: 0, collectedCents: 0 });
		expect(again.reversals).toEqual([]);
	});

	it("collects open charges oldest first, never past the seller's share of the sale", async () => {
		// Seller's share: 4099 - 2177 = 1922, less 22 already reversed = 1900.
		const { deps, reversals, collections } = fakeDeps({
			reversed: 22,
			charges: [
				{ id: 'sc_1', amountCents: 1500, collectedCents: 0 },
				{ id: 'sc_2', amountCents: 800, collectedCents: 100 },
			],
		});
		expect(await settleSale(deps, ORDER)).toEqual({ feeDifferenceCents: 0, collectedCents: 1900 });
		expect(reversals).toEqual([
			{ amountCents: 1500, idempotencyKey: 'seller-charge-sc_1-ord_1' },
			{ amountCents: 400, idempotencyKey: 'seller-charge-sc_2-ord_1' },
		]);
		expect(collections).toEqual([
			{ chargeId: 'sc_1', amountCents: 1500 },
			{ chargeId: 'sc_2', amountCents: 400 },
		]);
	});

	it('leaves a sale with no transfer alone', async () => {
		const { deps, reversals } = fakeDeps();
		deps.stripe.retrievePaymentIntent = async (id) => ({ id, latest_charge: null });
		expect(await settleSale(deps, ORDER)).toEqual({ feeDifferenceCents: 0, collectedCents: 0 });
		expect(reversals).toEqual([]);
	});
});
