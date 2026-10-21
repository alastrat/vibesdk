import { afterEach, describe, expect, it, vi } from 'vitest';
import { creditBalance, type PeriodState } from './credit-ledger';
import { noticeCreditUse, type CreditNoticeDeps } from './credit-notices';
import type { OutgoingEmail } from '../email/types';
import type { BillingAnalyticsEvent } from '../posthog/billing-events';

const PERIOD = { key: 'acct:1790812800', startMs: 1_790_812_800_000, endMs: 1_793_404_800_000 };

afterEach(() => vi.restoreAllMocks());

function state(used: number): PeriodState {
	return { key: PERIOD.key, startMs: PERIOD.startMs, endMs: PERIOD.endMs, pool: 5_000, granted: 0, used, settled: 0, closed: false };
}

function deps(purchased = 0) {
	const sent: OutgoingEmail[] = [];
	const claimed = new Set<string>();
	const tracked: Array<[string, readonly BillingAnalyticsEvent[]]> = [];
	let reads = 0;
	let current = state(0);
	const fake: CreditNoticeDeps = {
		readBalance: async () => {
			reads += 1;
			return creditBalance({ current, open: [], purchases: purchased > 0 ? [{ id: 'cp', credits: purchased, used: 0, removed: 0, purchasedAtMs: 0, expiresAtMs: Number.MAX_SAFE_INTEGER }] : [] });
		},
		mail: {
			sender: { send: async (email) => void sent.push(email) },
			userEmail: async () => 'ana@example.test',
			baseUrl: 'https://estori.app',
			claim: async (_userId, key) => {
				if (claimed.has(key)) return false;
				claimed.add(key);
				return true;
			},
			release: async (_userId, key) => void claimed.delete(key),
		},
		track: async (userId, events) => void tracked.push([userId, events]),
	};
	return { fake, sent, tracked, reads: () => reads, at: (used: number) => (current = state(used)) };
}

describe('noticeCreditUse', () => {
	it('warns at 20% and 5% of the credits left, each once a period, and skips the read while the pool is above 20%', async () => {
		const { fake, sent, reads, at } = deps();
		const use = (used: number) => noticeCreditUse(fake, { userId: 'u1', plan: 'basic', period: PERIOD, pool: 5_000, state: at(used) });
		expect(await use(3_000)).toBeNull();
		expect(reads()).toBe(0);
		expect(await use(4_000)).toBe('credits_20');
		expect(await use(4_100)).toBeNull();
		expect(await use(4_800)).toBe('credits_5');
		expect(await use(5_200)).toBeNull();
		expect(sent.map((email) => email.subject)).toEqual(['You have 20% of your AI credits left', 'You have 5% of your AI credits left']);
	});

	it('counts purchased credits in what is left', async () => {
		const { fake, sent, at } = deps(5_000);
		expect(await noticeCreditUse(fake, { userId: 'u1', plan: 'premium', period: PERIOD, pool: 5_000, state: at(4_500) })).toBeNull();
		expect(sent).toEqual([]);
	});

	it('sends credits_low for a claim that is new and kept, whether or not the email went out, and not while an outage gives it back', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { fake, tracked, at } = deps();
		const failingWith = (error: Error): CreditNoticeDeps => ({ ...fake, mail: { ...fake.mail, sender: { send: async () => { throw error; } } } });
		const use = (notices: CreditNoticeDeps, used: number) => noticeCreditUse(notices, { userId: 'u1', plan: 'pro', period: PERIOD, pool: 5_000, state: at(used) });
		// An outage gives the claim back, so the next step tries again; counting it now would count it on every step.
		expect(await use(failingWith(new Error('Email Service unavailable')), 4_000)).toBeNull();
		expect(tracked).toEqual([]);
		expect(await use(fake, 4_050)).toBe('credits_20');
		expect(await use(fake, 4_100)).toBeNull();
		expect(tracked).toEqual([['u1', [{ name: 'credits_low', properties: { plan: 'pro', threshold: 20 } }]]]);
		// An address that refuses mail keeps the claim: the threshold was reached once, though no email went.
		expect(await use(failingWith(Object.assign(new Error('suppressed'), { code: 'E_RECIPIENT_SUPPRESSED' })), 4_800)).toBeNull();
		expect(await use(fake, 4_900)).toBeNull();
		expect(tracked).toEqual([
			['u1', [{ name: 'credits_low', properties: { plan: 'pro', threshold: 20 } }]],
			['u1', [{ name: 'credits_low', properties: { plan: 'pro', threshold: 5 } }]],
		]);
	});

	it('answers null instead of throwing when the balance cannot be read', async () => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { fake, sent, at } = deps();
		const failing: CreditNoticeDeps = {
			...fake,
			readBalance: async () => {
				throw new Error('D1_ERROR: network connection lost');
			},
		};
		expect(await noticeCreditUse(failing, { userId: 'u1', plan: 'basic', period: PERIOD, pool: 5_000, state: at(4_900) })).toBeNull();
		expect(sent).toEqual([]);
		expect(errorLog).toHaveBeenCalledTimes(1);
	});
});
