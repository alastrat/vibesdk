import { describe, expect, it } from 'vitest';
import { refundStoreLines, type RefundLinesDeps } from './refund-lines';
import type { StoreOrderView } from './store';

const ORDER: StoreOrderView = {
	id: 'ord_1', orderNumber: 1, mode: 'test', appId: 'app_1', paymentStatus: 'paid', fulfillmentStatus: 'unfulfilled',
	subtotalCents: 6599, shippingCents: 0, totalCents: 6599, applicationFeeCents: 2249, currency: 'usd',
	customerEmail: null, customerName: null, shippingAddress: null, note: null, needsAttention: null,
	stripeCheckoutSessionId: 'cs_1', createdAt: new Date(0),
	sellerUserId: 'u1', sellerStripeAccountId: 'acct_1', stripePaymentIntentId: 'pi_1', refundedCents: 0,
	items: [
		{ lineNo: 1, kind: 'catalog', productId: 'feeder', variantId: 'feeder-blue', name: 'Feeder, Blue', quantity: 1, unitPriceCents: 4099, catalogVariantId: 'cv_feeder', lockedCatalogPriceCents: 2028 },
		{ lineNo: 2, kind: 'own', productId: 'gift', variantId: 'gift-25', name: 'Gift Card', quantity: 1, unitPriceCents: 2500, catalogVariantId: null, lockedCatalogPriceCents: null },
	],
};

function fakeDeps(input: { balance?: number; refunded?: number[] } = {}) {
	const calls: string[] = [];
	const recorded: Array<{ lineNo: number; amountCents: number; initiatedBy: string }> = [];
	const deps: RefundLinesDeps = {
		stripe: {
			retrievePaymentIntent: async (id) => ({ id, latest_charge: { id: 'ch_1', transfer: { id: 'tr_1', amount: 6599, amount_reversed: 0 } } }),
			createRefund: async (refund) => {
				calls.push(`refund ${refund.amountCents} ${refund.idempotencyKey}`);
				return { id: `re_${calls.length}`, amount: refund.amountCents, status: 'succeeded' };
			},
			createTransferReversal: async (reversal) => {
				calls.push(`reversal ${reversal.amountCents} ${reversal.idempotencyKey}`);
				return { id: `trr_${calls.length}`, amount: reversal.amountCents };
			},
		},
		sellerBalance: async () => ({ availableCents: input.balance ?? 100_000, pendingCents: 0 }),
		refundedLines: async () => new Set(input.refunded ?? []),
		refundCatalogLines: async (lineNos) => {
			calls.push(`catalog ${lineNos.join(',')}`);
			return { ok: true, refundedCents: 4099 };
		},
		recordRefund: async (entry) => void recorded.push({ lineNo: entry.lineNo, amountCents: entry.amountCents, initiatedBy: entry.initiatedBy }),
		applyRefunds: async () => void calls.push('apply'),
		now: () => new Date(0),
	};
	return { deps, calls, recorded };
}

describe('refundStoreLines', () => {
	it("refunds an own line in full and takes it back from the seller's transfer, then updates the order", async () => {
		const { deps, calls, recorded } = fakeDeps();
		expect(await refundStoreLines(deps, { order: ORDER, lineNos: [2], requestId: 'rq_1' })).toEqual({ ok: true, refundedCents: 2500 });
		expect(calls).toEqual(['refund 2500 store-refund-rq_1-2', 'reversal 2500 store-reversal-rq_1-2', 'apply']);
		expect(recorded).toEqual([{ lineNo: 2, amountCents: 2500, initiatedBy: 'seller' }]);
	});

	it('hands catalog lines to the catalog refund', async () => {
		const { deps, calls } = fakeDeps();
		expect(await refundStoreLines(deps, { order: ORDER, lineNos: [1, 2], requestId: 'rq_1' })).toEqual({ ok: true, refundedCents: 6599 });
		expect(calls[0]).toBe('catalog 1');
	});

	it("refuses when the seller's balance is short, before any money moves", async () => {
		const { deps, calls } = fakeDeps({ balance: 2499 });
		expect(await refundStoreLines(deps, { order: ORDER, lineNos: [2], requestId: 'rq_1' })).toEqual({ ok: false, reason: 'seller_balance_short', shortCents: 1 });
		expect(calls).toEqual([]);
	});

	it('never refunds a line twice, whatever the request id', async () => {
		const { deps, calls } = fakeDeps({ refunded: [2] });
		expect(await refundStoreLines(deps, { order: ORDER, lineNos: [2], requestId: 'rq_2' })).toEqual({ ok: false, reason: 'nothing_to_refund' });
		expect(calls).toEqual([]);
	});
});
