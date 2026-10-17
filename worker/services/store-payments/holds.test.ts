import { describe, expect, it } from 'vitest';
import { releaseOldestHolds, type Hold } from './holds';

const HOLDS: Hold[] = [
	{ id: 'chk_a', sessionId: 'cs_a', weightedCents: 3000 },
	{ id: 'chk_b', sessionId: 'cs_b', weightedCents: 3000 },
	{ id: 'chk_c', sessionId: 'cs_c', weightedCents: 3000 },
];

function world(options: { paidMeanwhile?: string[]; stripeDown?: string[] } = {}) {
	const expiredSessions: string[] = [];
	const expired: string[] = [];
	const deps = {
		holds: async () => HOLDS,
		expireSession: async (sessionId: string) => {
			if (options.stripeDown?.includes(sessionId)) throw new Error('Stripe is unreachable');
			expiredSessions.push(sessionId);
		},
		markExpired: async (id: string) => {
			if (options.paidMeanwhile?.includes(id)) return false;
			expired.push(id);
			return true;
		},
	};
	return { deps, expiredSessions, expired };
}

describe('releasing unpaid checkouts', () => {
	it('expires the oldest ones, at Stripe and here, until enough of the cap is free', async () => {
		const { deps, expiredSessions, expired } = world();
		expect(await releaseOldestHolds(deps, 4000)).toBe(6000);
		expect(expiredSessions).toEqual(['cs_a', 'cs_b']);
		expect(expired).toEqual(['chk_a', 'chk_b']);
	});

	it("counts nothing for a checkout paid in the meantime, and stops when Stripe can't be reached", async () => {
		expect(await releaseOldestHolds(world({ paidMeanwhile: ['chk_a'] }).deps, 4000)).toBe(6000);
		const down = world({ stripeDown: ['cs_b'] });
		expect(await releaseOldestHolds(down.deps, 9000)).toBe(3000);
		expect(down.expired).toEqual(['chk_a']);
	});

	it('releases nothing when nothing is needed', async () => {
		const { deps, expiredSessions } = world();
		expect(await releaseOldestHolds(deps, 0)).toBe(0);
		expect(expiredSessions).toEqual([]);
	});
});
