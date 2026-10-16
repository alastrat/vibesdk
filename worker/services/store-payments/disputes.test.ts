import { describe, expect, it } from 'vitest';
import { handleDisputeClosed, handleDisputeOpened, type DisputeDeps, type StoredDispute, type StripeDispute } from './disputes';
import { StripeApiError } from '../payments/stripe-client';

const DISPUTE: StripeDispute = { id: 'dp_1', amount: 6599, charge: 'ch_1', payment_intent: 'pi_1', reason: 'fraudulent', status: 'needs_response', balance_transactions: [{ fee: 1500 }] };

/** A small D1 and Stripe in memory: the stored dispute, the seller's charges, and every money move. */
function world(input: { reversed?: number; known?: boolean; reversal?: 'ok' | 'refused' | 'conflict'; withheldCents?: number } = {}) {
	const moves: string[] = [];
	const events: string[] = [];
	let stored: StoredDispute | null = null;
	const charges = new Map<string, { amountCents: number; collectedCents: number }>();
	let reversedOnTransfer = input.reversed ?? 0;
	const deps: DisputeDeps = {
		findOrder: async () => (input.known === false ? null : { id: 'ord_1', sellerUserId: 'u1', sellerStripeAccountId: 'acct_1', checkoutSessionId: 'cs_1' }),
		stripe: {
			retrievePaymentIntent: async (id) => ({ id, latest_charge: { id: 'ch_1', transfer: { id: 'tr_1', amount: 6599, amount_reversed: reversedOnTransfer } } }),
			createTransferReversal: async (reversal) => {
				if (input.reversal === 'refused') throw new StripeApiError('Insufficient funds', 400, 'insufficient_funds', 'invalid_request_error');
				if (input.reversal === 'conflict') throw new StripeApiError('Another request is using this key', 409, null, 'idempotency_error');
				// Stripe replays a key: the same key never reverses twice.
				if (!moves.includes(`reversal ${reversal.amountCents} ${reversal.idempotencyKey}`)) {
					moves.push(`reversal ${reversal.amountCents} ${reversal.idempotencyKey}`);
					reversedOnTransfer += reversal.amountCents;
				}
				return { id: 'trr_1', amount: reversal.amountCents };
			},
			createTransfer: async (transfer) => {
				moves.push(`transfer ${transfer.amountCents} ${transfer.idempotencyKey}`);
				return { id: 'tr_9', amount: transfer.amountCents };
			},
		},
		storedDispute: async () => stored,
		saveDispute: async (row) => {
			stored = { status: row.status, reversalState: row.reversalState, reversedCents: row.reversedCents, feeCents: row.feeCents, returnedCents: row.returnedCents };
		},
		addCharge: async (charge) => {
			const key = `${charge.kind}:${charge.sourceId}`;
			if (!charges.has(key)) charges.set(key, { amountCents: charge.amountCents, collectedCents: 0 });
		},
		setCharge: async (charge) => {
			const key = `${charge.kind}:${charge.sourceId}`;
			const current = charges.get(key) ?? { amountCents: 0, collectedCents: 0 };
			charges.set(key, { ...current, amountCents: charge.amountCents });
			return current.collectedCents;
		},
		withholdCatalog: async () => void events.push('withhold'),
		releaseCatalog: async () => void events.push('release'),
		withheldCatalogCents: async () => input.withheldCents ?? 0,
		setOrderStatus: async (status) => void events.push(`order ${status}`),
		recomputeOrderStatus: async () => void events.push('order recomputed'),
		alert: async (alert) => void events.push(`alert ${alert.kind}`),
		recheckSellerLevel: async (sellerUserId) => void events.push(`level check ${sellerUserId} after ${stored?.status ?? 'nothing'} saved`),
		now: () => new Date(0),
	};
	return { deps, moves, events, charges, collect: (key: string, cents: number) => {
		const charge = charges.get(key);
		if (charge) charges.set(key, { ...charge, collectedCents: cents });
	}, stored: () => stored };
}

describe('handleDisputeOpened', () => {
	it('takes the disputed amount back once, charges the fee, holds unplaced catalog items and alerts', async () => {
		const { deps, moves, events, charges } = world();
		expect(await handleDisputeOpened(deps, DISPUTE)).toBe('recorded');
		expect(moves).toEqual(['reversal 6599 dispute-reversal-dp_1']);
		expect([...charges.entries()]).toEqual([['dispute-fee:dp_1', { amountCents: 1500, collectedCents: 0 }]]);
		expect(events).toEqual(['withhold', 'order disputed', 'alert dispute-opened']);
	});

	it('moves no money again when Stripe delivers the event twice', async () => {
		const { deps, moves, charges, stored } = world();
		await handleDisputeOpened(deps, DISPUTE);
		await handleDisputeOpened(deps, DISPUTE);
		expect(moves).toEqual(['reversal 6599 dispute-reversal-dp_1']);
		expect([...charges.keys()]).toEqual(['dispute-fee:dp_1']);
		expect(stored()).toMatchObject({ reversalState: 'done', reversedCents: 6599 });
	});

	it('leaves a key conflict for Stripe to retry instead of charging the seller a shortfall', async () => {
		const { deps, charges, stored } = world({ reversal: 'conflict' });
		await expect(handleDisputeOpened(deps, DISPUTE)).rejects.toBeInstanceOf(StripeApiError);
		expect(charges.has('dispute-shortfall:dp_1')).toBe(false);
		// The planned amount is kept, so the retry sends the same reversal.
		expect(stored()).toMatchObject({ reversalState: 'planned', reversedCents: 6599 });
	});

	it('charges the whole amount when Stripe refuses the reversal', async () => {
		const { deps, charges } = world({ reversal: 'refused' });
		await handleDisputeOpened(deps, DISPUTE);
		expect(charges.get('dispute-shortfall:dp_1')).toEqual({ amountCents: 6599, collectedCents: 0 });
	});

	it('takes only what is left of a partly refunded transfer, and charges the rest', async () => {
		const { deps, moves, charges } = world({ reversed: 2500 });
		await handleDisputeOpened(deps, DISPUTE);
		expect(moves).toEqual(['reversal 4099 dispute-reversal-dp_1']);
		expect(charges.get('dispute-shortfall:dp_1')).toEqual({ amountCents: 2500, collectedCents: 0 });
	});

	it('takes nothing for an inquiry, where Stripe takes nothing, and does so once it becomes a chargeback', async () => {
		const { deps, moves, events, charges } = world();
		await handleDisputeOpened(deps, { ...DISPUTE, status: 'warning_needs_response', balance_transactions: [] });
		expect(moves).toEqual([]);
		expect(charges.size).toBe(0);
		expect(events).toEqual(['alert dispute-opened']);

		await handleDisputeOpened(deps, DISPUTE);
		expect(moves).toEqual(['reversal 6599 dispute-reversal-dp_1']);
		expect(charges.has('dispute-fee:dp_1')).toBe(true);
	});

	it('ignores disputes on payments that are not store orders', async () => {
		const { deps, moves, events } = world({ known: false });
		expect(await handleDisputeOpened(deps, DISPUTE)).toBe('not-ours');
		expect([...moves, ...events]).toEqual([]);
	});
});

describe('handleDisputeClosed', () => {
	it('returns what was taken and any shortfall paid when the seller wins, releases held catalog items, and recomputes the order', async () => {
		const w = world({ reversed: 2500 });
		await handleDisputeOpened(w.deps, DISPUTE);
		w.collect('dispute-shortfall:dp_1', 2500);
		w.collect('dispute-fee:dp_1', 1500);
		w.moves.length = 0;
		w.events.length = 0;

		expect(await handleDisputeClosed(w.deps, { ...DISPUTE, status: 'won', balance_transactions: [{ fee: 1500 }, { fee: -1500 }] })).toBe('won');
		expect(w.moves).toEqual(['transfer 4099 dispute-return-dp_1', 'transfer 2500 dispute-shortfall-return-dp_1', 'transfer 1500 dispute-fee-return-dp_1']);
		expect(w.charges.get('dispute-shortfall:dp_1')?.amountCents).toBe(0);
		expect(w.events).toEqual(['release', 'order recomputed', 'alert dispute-closed']);
	});

	it('pays nothing back a second time when the close is delivered again, even days later', async () => {
		const w = world();
		await handleDisputeOpened(w.deps, DISPUTE);
		await handleDisputeClosed(w.deps, { ...DISPUTE, status: 'won', balance_transactions: [{ fee: 1500 }, { fee: -1500 }] });
		w.moves.length = 0;
		expect(await handleDisputeClosed(w.deps, { ...DISPUTE, status: 'won', balance_transactions: [{ fee: 1500 }, { fee: -1500 }] })).toBe('won');
		expect(w.moves).toEqual([]);
	});

	it("charges the seller Stripe's countered fee when the dispute is lost, and returns the catalog price of items never bought", async () => {
		const w = world({ withheldCents: 2028 });
		await handleDisputeOpened(w.deps, DISPUTE);
		w.moves.length = 0;
		w.events.length = 0;
		expect(await handleDisputeClosed(w.deps, { ...DISPUTE, status: 'lost', balance_transactions: [{ fee: 1500 }, { fee: 1500 }] })).toBe('lost');
		expect(w.charges.get('dispute-fee:dp_1')?.amountCents).toBe(3000);
		expect(w.moves).toEqual(['transfer 2028 dispute-withheld-dp_1']);
		expect(w.events).toEqual(['order dispute_lost', 'level check u1 after lost saved', 'alert dispute-closed']);
	});

	it('closes an inquiry that never became a chargeback as owing nothing', async () => {
		const w = world();
		await handleDisputeOpened(w.deps, { ...DISPUTE, status: 'warning_needs_response', balance_transactions: [] });
		w.events.length = 0;
		expect(await handleDisputeClosed(w.deps, { ...DISPUTE, status: 'warning_closed', balance_transactions: [] })).toBe('inquiry-closed');
		expect(w.moves).toEqual([]);
		expect(w.events).toEqual(['order recomputed', 'alert dispute-closed']);
	});

	it("re-checks the seller's level once the loss is saved, so the check counts it, and not after a win", async () => {
		const lost = world();
		await handleDisputeOpened(lost.deps, DISPUTE);
		await handleDisputeClosed(lost.deps, { ...DISPUTE, status: 'lost' });
		expect(lost.events.filter((event) => event.startsWith('level check'))).toEqual(['level check u1 after lost saved']);

		const won = world();
		await handleDisputeOpened(won.deps, DISPUTE);
		await handleDisputeClosed(won.deps, { ...DISPUTE, status: 'won' });
		expect(won.events.filter((event) => event.startsWith('level check'))).toEqual([]);
	});
});
