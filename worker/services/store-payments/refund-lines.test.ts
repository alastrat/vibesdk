import { describe, expect, it } from 'vitest';
import { refundStoreLines, type RefundLinesDeps, type StoreRefundRow } from './refund-lines';
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

/** D1 and Stripe in memory, shared by every request made against them. */
function world(input: { balance?: number; reversible?: number; catalogSellerCents?: number; rows?: StoreRefundRow[]; reversalFails?: boolean } = {}) {
	const calls: string[] = [];
	const shortfalls: Array<{ lineNo: number; amountCents: number }> = [];
	const rows = new Map((input.rows ?? []).map((row) => [row.lineNo, { ...row }]));
	let reversalFails = input.reversalFails ?? false;
	const deps: RefundLinesDeps = {
		stripe: {
			retrievePaymentIntent: async (id) => ({ id, latest_charge: { id: 'ch_1', transfer: { id: 'tr_1', amount: 6599, amount_reversed: 6599 - (input.reversible ?? 6599) } } }),
			createRefund: async (refund) => {
				calls.push(`refund ${refund.amountCents} ${refund.idempotencyKey}`);
				return { id: `re_${refund.idempotencyKey}`, amount: refund.amountCents, status: 'succeeded' };
			},
			createTransferReversal: async (reversal) => {
				if (reversalFails) throw new Error('Stripe is unavailable');
				calls.push(`reversal ${reversal.amountCents} ${reversal.idempotencyKey}`);
				return { id: `trr_${reversal.idempotencyKey}`, amount: reversal.amountCents };
			},
		},
		sellerBalance: async () => ({ availableCents: input.balance ?? 100_000, pendingCents: 0 }),
		refundRows: async () => new Map([...rows.entries()].map(([lineNo, row]) => [lineNo, { ...row }])),
		catalogSellerCents: async () => input.catalogSellerCents ?? 4099,
		refundCatalogLines: async (lineNos) => {
			calls.push(`catalog ${lineNos.join(',')}`);
			return { refundedCents: 4099 };
		},
		// Atomic, as one D1 statement: the first request to claim a line keeps it.
		claimRefund: async (claim) => {
			const existing = rows.get(claim.lineNo);
			if (existing) return { ...existing };
			const row: StoreRefundRow = { lineNo: claim.lineNo, requestId: claim.requestId, amountCents: claim.amountCents, reversalCents: claim.reversalCents, stripeRefundId: null, reversalId: null };
			rows.set(claim.lineNo, row);
			return { ...row };
		},
		completeRefund: async (done) => {
			const row = rows.get(done.lineNo);
			if (row) row.stripeRefundId = done.stripeRefundId;
		},
		completeReversal: async (done) => {
			const row = rows.get(done.lineNo);
			if (row) row.reversalId = done.reversalId;
		},
		addShortfall: async (shortfall) => void shortfalls.push({ lineNo: shortfall.lineNo, amountCents: shortfall.amountCents }),
		applyRefunds: async () => void calls.push('apply'),
		now: () => new Date(0),
	};
	return { deps, calls, shortfalls, rows, heal: () => (reversalFails = false) };
}

describe('refundStoreLines', () => {
	it("refunds an own line in full and takes it back from the seller's transfer, then updates the order", async () => {
		const { deps, calls, rows } = world();
		expect(await refundStoreLines(deps, { order: ORDER, lineNos: [2], requestId: 'rq_1' })).toEqual({ ok: true, refundedCents: 2500 });
		expect(calls).toEqual(['refund 2500 store-refund-rq_1-2', 'reversal 2500 store-reversal-rq_1-2', 'apply']);
		expect(rows.get(2)).toMatchObject({ stripeRefundId: 're_store-refund-rq_1-2', reversalId: 'trr_store-reversal-rq_1-2' });
	});

	it('hands catalog lines to the catalog refund', async () => {
		const { deps, calls } = world();
		expect(await refundStoreLines(deps, { order: ORDER, lineNos: [1, 2], requestId: 'rq_1' })).toEqual({ ok: true, refundedCents: 6599 });
		expect(calls[0]).toBe('catalog 1');
	});

	it("refuses when the seller's balance is short, before any money moves", async () => {
		const { deps, calls } = world({ balance: 2499 });
		expect(await refundStoreLines(deps, { order: ORDER, lineNos: [2], requestId: 'rq_1' })).toEqual({ ok: false, reason: 'seller_balance_short', shortCents: 1 });
		expect(calls).toEqual([]);
	});

	it('checks own and catalog lines against the balance together', async () => {
		const { deps, calls } = world({ balance: 3000, catalogSellerCents: 2500 });
		expect(await refundStoreLines(deps, { order: ORDER, lineNos: [1, 2], requestId: 'rq_1' })).toEqual({ ok: false, reason: 'seller_balance_short', shortCents: 2000 });
		expect(calls).toEqual([]);
	});

	it("charges the seller what the sale's transfer can no longer cover, instead of Estori paying it", async () => {
		const { deps, calls, shortfalls } = world({ reversible: 1000 });
		expect(await refundStoreLines(deps, { order: ORDER, lineNos: [2], requestId: 'rq_1' })).toEqual({ ok: true, refundedCents: 2500 });
		expect(calls).toEqual(['refund 2500 store-refund-rq_1-2', 'reversal 1000 store-reversal-rq_1-2', 'apply']);
		expect(shortfalls).toEqual([{ lineNo: 2, amountCents: 1500 }]);
	});

	it('takes back a reversal that failed after the refund on the next request, with the first request\'s key, and refunds nothing again', async () => {
		const w = world({ reversalFails: true });
		await expect(refundStoreLines(w.deps, { order: ORDER, lineNos: [2], requestId: 'rq_1' })).rejects.toThrow('Stripe is unavailable');
		w.heal();
		w.calls.length = 0;
		expect(await refundStoreLines(w.deps, { order: ORDER, lineNos: [2], requestId: 'rq_2' })).toEqual({ ok: true, refundedCents: 0 });
		expect(w.calls).toEqual(['reversal 2500 store-reversal-rq_1-2', 'apply']);
	});

	it('keeps a shortfall whose record failed, and records it on the next request', async () => {
		const w = world({ reversible: 0 });
		const addShortfall = w.deps.addShortfall;
		w.deps.addShortfall = async () => {
			throw new Error('D1 is unavailable');
		};
		await expect(refundStoreLines(w.deps, { order: ORDER, lineNos: [2], requestId: 'rq_1' })).rejects.toThrow('D1 is unavailable');
		w.deps.addShortfall = addShortfall;
		await refundStoreLines(w.deps, { order: ORDER, lineNos: [2], requestId: 'rq_2' });
		expect(w.shortfalls).toEqual([{ lineNo: 2, amountCents: 2500 }]);
		expect(new Set(w.calls.filter((call) => call.startsWith('refund ')))).toEqual(new Set(['refund 2500 store-refund-rq_1-2']));
	});

	it('refunds a line once when two requests for it arrive at the same time', async () => {
		const { deps, calls } = world();
		await Promise.all([refundStoreLines(deps, { order: ORDER, lineNos: [2], requestId: 'rq_1' }), refundStoreLines(deps, { order: ORDER, lineNos: [2], requestId: 'rq_2' })]);
		// The loser reuses the winner's keys, so Stripe answers it with the same refund and reversal.
		expect(new Set(calls.filter((call) => call.startsWith('refund ')))).toEqual(new Set(['refund 2500 store-refund-rq_1-2']));
		expect(new Set(calls.filter((call) => call.startsWith('reversal ')))).toEqual(new Set(['reversal 2500 store-reversal-rq_1-2']));
	});

	it('never refunds a finished line again, whatever the request id', async () => {
		const { deps, calls } = world({ rows: [{ lineNo: 2, requestId: 'rq_1', amountCents: 2500, reversalCents: 2500, stripeRefundId: 're_1', reversalId: 'trr_1' }] });
		expect(await refundStoreLines(deps, { order: ORDER, lineNos: [2], requestId: 'rq_2' })).toEqual({ ok: false, reason: 'nothing_to_refund' });
		expect(calls).toEqual([]);
	});

	it("names line numbers that aren't on the order, before any money moves", async () => {
		const { deps, calls } = world();
		expect(await refundStoreLines(deps, { order: ORDER, lineNos: [2, 9], requestId: 'rq_1' })).toEqual({ ok: false, reason: 'unknown_lines', lineNos: [9] });
		expect(calls).toEqual([]);
	});
});
