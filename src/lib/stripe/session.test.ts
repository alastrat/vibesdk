import { describe, expect, it } from 'vitest';
import { sessionStatusOf } from './session';
import type { StripeCheckoutSession } from './stripe-js';

/** A session that counts how often the page read its total, which Stripe.js checks before it confirms. */
function watched(status: StripeCheckoutSession['status']['type']): { session: StripeCheckoutSession; reads: () => number } {
	let reads = 0;
	const session: StripeCheckoutSession = {
		canConfirm: true,
		status: { type: status },
		get total() {
			return {
				get total() {
					reads += 1;
					return { amount: '$0.00', minorUnitsAmount: 0 };
				},
			};
		},
	};
	return { session, reads: () => reads };
}

describe("reading a session's status", () => {
	it('gives the status, and reads the total on the way, since Stripe.js refuses to confirm a session whose total was never read', () => {
		const { session, reads } = watched('open');
		expect(sessionStatusOf(session)).toBe('open');
		expect(reads()).toBe(1);
	});

	it('reads the total of an expired and a complete session too', () => {
		for (const status of ['expired', 'complete'] as const) {
			const { session, reads } = watched(status);
			expect(sessionStatusOf(session)).toBe(status);
			expect(reads()).toBe(1);
		}
	});

	it('still gives the status of a session that carries no total, as a setup session may', () => {
		const bare = { canConfirm: true, status: { type: 'open' } } as unknown as StripeCheckoutSession;
		expect(sessionStatusOf(bare)).toBe('open');
	});
});
