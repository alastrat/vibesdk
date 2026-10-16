import { describe, expect, it } from 'vitest';
import { handleDisputeClosed, handleDisputeOpened, type DisputeDeps, type StripeDispute } from './disputes';

const DISPUTE: StripeDispute = { id: 'dp_1', amount: 6599, charge: 'ch_1', payment_intent: 'pi_1', reason: 'fraudulent', status: 'needs_response', balance_transactions: [{ fee: 1500 }] };

function fakeDeps(input: { reversed?: number; stored?: { reversedCents: number; feeCents: number } | null; known?: boolean; reversalFails?: boolean } = {}) {
	const calls: string[] = [];
	const deps: DisputeDeps = {
		findOrder: async () => (input.known === false ? null : { id: 'ord_1', sellerUserId: 'u1', sellerStripeAccountId: 'acct_1', checkoutSessionId: 'cs_1' }),
		stripe: {
			retrievePaymentIntent: async (id) => ({ id, latest_charge: { id: 'ch_1', transfer: { id: 'tr_1', amount: 6599, amount_reversed: input.reversed ?? 0 } } }),
			createTransferReversal: async (reversal) => {
				if (input.reversalFails) throw new Error('Stripe refused');
				calls.push(`reversal ${reversal.amountCents} ${reversal.idempotencyKey}`);
				return { id: 'trr_1', amount: reversal.amountCents };
			},
			createTransfer: async (transfer) => {
				calls.push(`transfer ${transfer.amountCents} ${transfer.idempotencyKey}`);
				return { id: 'tr_9', amount: transfer.amountCents };
			},
		},
		storedDispute: async () => input.stored ?? null,
		saveDispute: async (row) => void calls.push(`save ${row.status} reversed=${row.reversedCents} fee=${row.feeCents}`),
		addCharge: async (charge) => void calls.push(`charge ${charge.kind} ${charge.amountCents}`),
		setFeeCharge: async (amountCents) => void calls.push(`fee charge ${amountCents}`),
		withholdCatalog: async () => void calls.push('withhold'),
		setOrderStatus: async (status) => void calls.push(`order ${status}`),
		alert: async (alert) => void calls.push(`alert ${alert.kind}`),
		now: () => new Date(0),
	};
	return { deps, calls };
}

describe('handleDisputeOpened', () => {
	it('takes the disputed amount back, charges the fee, holds unplaced catalog items and alerts', async () => {
		const { deps, calls } = fakeDeps();
		expect(await handleDisputeOpened(deps, DISPUTE)).toBe('recorded');
		expect(calls).toEqual(['reversal 6599 dispute-reversal-dp_1', 'charge dispute-fee 1500', 'withhold', 'order disputed', 'save needs_response reversed=6599 fee=1500', 'alert dispute-opened']);
	});

	it('takes only what is left of a partly refunded transfer, and charges the rest', async () => {
		const { deps, calls } = fakeDeps({ reversed: 2500 });
		await handleDisputeOpened(deps, DISPUTE);
		expect(calls).toContain('reversal 4099 dispute-reversal-dp_1');
		expect(calls).toContain('charge dispute-shortfall 2500');
	});

	it('charges the whole amount when Stripe refuses the reversal', async () => {
		const { deps, calls } = fakeDeps({ reversalFails: true });
		await handleDisputeOpened(deps, DISPUTE);
		expect(calls).toContain('charge dispute-shortfall 6599');
	});

	it('ignores disputes on payments that are not store orders', async () => {
		const { deps, calls } = fakeDeps({ known: false });
		expect(await handleDisputeOpened(deps, DISPUTE)).toBe('not-ours');
		expect(calls).toEqual([]);
	});
});

describe('handleDisputeClosed', () => {
	it('returns what was taken when the seller wins, and the fee if Stripe returned it', async () => {
		const { deps, calls } = fakeDeps({ stored: { reversedCents: 6599, feeCents: 1500 } });
		expect(await handleDisputeClosed(deps, { ...DISPUTE, status: 'won', balance_transactions: [{ fee: 1500 }, { fee: -1500 }] })).toBe('won');
		expect(calls).toEqual(['transfer 6599 dispute-return-dp_1', 'fee charge 0', 'order paid', 'save won reversed=6599 fee=0', 'alert dispute-closed']);
	});

	it('keeps what was taken when the dispute is lost', async () => {
		const { deps, calls } = fakeDeps({ stored: { reversedCents: 6599, feeCents: 1500 } });
		expect(await handleDisputeClosed(deps, { ...DISPUTE, status: 'lost' })).toBe('lost');
		expect(calls).toEqual(['order dispute_lost', 'save lost reversed=6599 fee=1500', 'alert dispute-closed']);
	});
});
