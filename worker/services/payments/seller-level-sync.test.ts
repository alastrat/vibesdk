import { describe, expect, it } from 'vitest';
import { syncSellerLevel, syncSellerLevels, type LevelSyncDeps } from './seller-level-sync';
import { DEFAULT_SELLER_LIMITS, type SellerRecord } from '../../../shared/types/seller-levels';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const ESTABLISHED: SellerRecord = { firstSaleAt: new Date(NOW - 60 * DAY), completedOrders: 20, ordersLast90Days: 20, disputesLast90Days: 0, lostDisputesLast90Days: 0 };
const NEW: SellerRecord = { ...ESTABLISHED, completedOrders: 2 };

function fakeDeps(input: { record: SellerRecord; stored?: { level: 'new' | 'established'; payoutDelayDays: number | null } | null; stripeFails?: boolean }) {
	const calls: string[] = [];
	const deps: LevelSyncDeps = {
		record: async () => input.record,
		settings: async () => DEFAULT_SELLER_LIMITS,
		stored: async () => (input.stored === null ? null : { stripeAccountId: 'acct_1', level: input.stored?.level ?? 'new', payoutDelayDays: input.stored?.payoutDelayDays ?? null, payoutInterval: 'weekly', payoutAnchor: 'monday' }),
		updateSchedule: async (accountId, schedule) => {
			if (input.stripeFails) throw new Error('Account restricted');
			calls.push(`stripe ${accountId} ${schedule.interval} ${schedule.weeklyAnchor} ${schedule.delayDays}`);
		},
		updateDelay: async (accountId, delayDays) => {
			if (input.stripeFails) throw new Error('Account restricted');
			calls.push(`stripe-delay ${accountId} ${delayDays}`);
		},
		saveLevel: async (level, delay) => void calls.push(`save ${level} ${delay}`),
		alert: async (alert) => void calls.push(`alert ${alert.kind}`),
	};
	return { deps, calls };
}

describe('syncSellerLevel', () => {
	it('does nothing when the level and delay already match', async () => {
		const { deps, calls } = fakeDeps({ record: NEW, stored: { level: 'new', payoutDelayDays: 10 } });
		expect(await syncSellerLevel(deps, 'u1', NOW)).toBe('unchanged');
		expect(calls).toEqual([]);
	});

	it("moves a seller up: only Stripe's delay changes, so a payout day the seller just changed is never undone; then the stored level, then an alert", async () => {
		const { deps, calls } = fakeDeps({ record: ESTABLISHED, stored: { level: 'new', payoutDelayDays: 10 } });
		expect(await syncSellerLevel(deps, 'u1', NOW)).toBe('changed');
		expect(calls).toEqual(['stripe-delay acct_1 5', 'save established 5', 'alert seller-level-changed']);
	});

	it("sets the whole schedule the seller sees on their first sync, without calling it a level change", async () => {
		const { deps, calls } = fakeDeps({ record: NEW, stored: { level: 'new', payoutDelayDays: null } });
		expect(await syncSellerLevel(deps, 'u1', NOW)).toBe('changed');
		expect(calls).toEqual(['stripe acct_1 weekly monday 10', 'save new 10']);
	});

	it("keeps the old level when Stripe refuses, and alerts", async () => {
		const { deps, calls } = fakeDeps({ record: ESTABLISHED, stored: { level: 'new', payoutDelayDays: 10 }, stripeFails: true });
		expect(await syncSellerLevel(deps, 'u1', NOW)).toBe('failed');
		expect(calls).toEqual(['alert seller-level-sync-failed']);
	});

	it('skips a seller with no Stripe account', async () => {
		const { deps } = fakeDeps({ record: NEW, stored: null });
		expect(await syncSellerLevel(deps, 'u1', NOW)).toBe('no-account');
	});
});

describe('syncSellerLevels', () => {
	it('checks every seller once, a few at a time, and one failure never stops the rest', async () => {
		let running = 0;
		let most = 0;
		const done: string[] = [];
		const ids = Array.from({ length: 12 }, (_, index) => `u${index}`);
		const checked = await syncSellerLevels({
			sellerIds: async () => [...ids, 'u0'],
			sync: async (sellerUserId) => {
				running += 1;
				most = Math.max(most, running);
				await new Promise((resolve) => setTimeout(resolve, 1));
				running -= 1;
				if (sellerUserId === 'u3') throw new Error('D1 is unavailable');
				done.push(sellerUserId);
			},
		});
		expect(checked).toBe(12);
		expect(done.sort()).toEqual(ids.filter((id) => id !== 'u3').sort());
		expect(most).toBeLessThanOrEqual(5);
	});
});
