import { describe, expect, it } from 'vitest';
import { takeStoreOffline } from './take-offline';
import type { Hold } from '../store-payments/holds';

const OPEN: Hold[] = [
	{ id: 'chk_a', sessionId: 'cs_a', weightedCents: 4000 },
	{ id: 'chk_b', sessionId: 'cs_b', weightedCents: 9000 },
];

function world(stripeDown = false) {
	const steps: string[] = [];
	const deps = {
		setOffline: async () => {
			steps.push('offline');
		},
		openCheckouts: async () => OPEN,
		expireSession: async (sessionId: string) => {
			if (stripeDown) throw new Error('Stripe is unreachable');
			steps.push(`expire ${sessionId}`);
		},
		markExpired: async (id: string) => (steps.push(`expired ${id}`), true),
	};
	return { deps, steps };
}

describe('taking a store offline', () => {
	it('closes the store first, then expires every checkout a shopper could still pay', async () => {
		const { deps, steps } = world();
		await takeStoreOffline(deps);
		expect(steps).toEqual(['offline', 'expire cs_a', 'expired chk_a', 'expire cs_b', 'expired chk_b']);
	});

	it("keeps the store closed when Stripe can't be reached", async () => {
		const { deps, steps } = world(true);
		await takeStoreOffline(deps);
		expect(steps).toEqual(['offline']);
	});
});
