/** The daily and hourly billing runs on real SQL, with Stripe stood in by fetch. */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { envWith, insertBillingCustomer, insertPurchase, insertSubscription, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { CreditLedgerService } from '../../database/services/CreditLedgerService';
import { handleBillingEvent } from './events';
import { runDailyBilling, runHourlyBilling } from './jobs';
import { billingEventDepsFromEnv } from './wiring';

let db: D1Database;
const DAY = 86_400_000;
const sent: string[] = [];

beforeAll(async () => {
	db = await migratedD1();
});

afterEach(() => {
	vi.restoreAllMocks();
	sent.length = 0;
});

function env(extra: Record<string, unknown> = {}): Env {
	return envWith(db, {
		BILLING: 'on',
		STRIPE_SECRET_KEY: 'sk_test_fake',
		STRIPE_PRICE_IDS: JSON.stringify({ pro: 'price_pro', premium: 'price_premium', credits: 'price_credits' }),
		CUSTOM_DOMAIN: 'estori.app',
		ENVIRONMENT: 'prod',
		EMAIL: {
			send: async (message: { to: string }) => {
				sent.push(message.to);
				return { messageId: 'm1' };
			},
		},
		VibecoderStore: { get: async () => null, put: async () => undefined },
		...extra,
	});
}

describe('the daily billing run', () => {
	it('re-reads a subscription a webhook may have missed', async () => {
		const now = Date.parse('2026-10-19T06:35:00Z');
		await insertUser(db, 'u_rep');
		await insertBillingCustomer(db, 'u_rep', 'cus_rep');
		await insertSubscription(db, { userId: 'u_rep', stripeSubscriptionId: 'sub_rep', status: 'past_due', currentPeriodStart: new Date(now - 3 * DAY), currentPeriodEnd: new Date(now + 27 * DAY) });
		const paid = { id: 'sub_rep', customer: 'cus_rep', status: 'active', created: 1, cancel_at_period_end: false, cancel_at: null, metadata: { estori_user_id: 'u_rep' }, schedule: null, items: { data: [{ id: 'si_1', price: { id: 'price_pro', metadata: null }, current_period_start: (now - 3 * DAY) / 1000, current_period_end: (now + 27 * DAY) / 1000 }] } };
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(paid));
		await runDailyBilling(env(), now);
		expect(await db.prepare("SELECT status FROM subscriptions WHERE user_id = 'u_rep'").first()).toEqual({ status: 'active' });
		expect(await db.prepare("SELECT result FROM billing_events WHERE stripe_event_id = 'repair:sub_rep:2026-10-19'").first()).toEqual({ result: 'applied' });
	});

	it("stores the plan's pool for a renewal the repair finds paid, ending the grace hold's pool of 0", async () => {
		const now = Date.parse('2026-10-19T06:35:00Z');
		const start = now - 3 * DAY;
		await insertUser(db, 'u_hold');
		await insertBillingCustomer(db, 'u_hold', 'cus_hold');
		await insertSubscription(db, { userId: 'u_hold', stripeSubscriptionId: 'sub_hold', status: 'past_due', currentPeriodStart: new Date(start), currentPeriodEnd: new Date(now + 27 * DAY) });
		const period = { key: `sub:sub_hold:${start / 1000}`, startMs: start, endMs: now + 27 * DAY };
		await new CreditLedgerService(env()).recordUse({ userId: 'u_hold', period, pool: 0, useKey: 'k_hold', credits: 2_000, source: 'think', model: 'm', usage: null, now: new Date(now - DAY) });
		const paid = { id: 'sub_hold', customer: 'cus_hold', status: 'active', created: 1, cancel_at_period_end: false, cancel_at: null, metadata: { estori_user_id: 'u_hold' }, schedule: null, items: { data: [{ id: 'si_1', price: { id: 'price_pro', metadata: null }, current_period_start: start / 1000, current_period_end: (now + 27 * DAY) / 1000 }] } };
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(paid));
		await runDailyBilling(env(), now);
		expect(await db.prepare("SELECT pool FROM credit_periods WHERE user_id = 'u_hold'").first('pool')).toBe(20_000);
	});

	it("takes nothing from purchases for a grace hold's usage, so the pool restored when the renewal is paid counts it once", async () => {
		const now = Date.parse('2026-10-19T06:35:00Z');
		const p1 = { key: `sub:sub_held:${(now - 32 * DAY) / 1000}`, startMs: now - 32 * DAY, endMs: now - 2 * DAY };
		const p2 = { key: `sub:sub_held:${(now - 2 * DAY) / 1000}`, startMs: now - 2 * DAY, endMs: now + 28 * DAY };
		await insertUser(db, 'u_held');
		await insertBillingCustomer(db, 'u_held', 'cus_held');
		await insertSubscription(db, { userId: 'u_held', stripeSubscriptionId: 'sub_held', status: 'past_due', currentPeriodStart: new Date(p2.startMs), currentPeriodEnd: new Date(p2.endMs) });
		await insertPurchase(db, { id: 'cp_held', userId: 'u_held', credits: 5_000, purchasedAt: new Date(now - 60 * DAY), expiresAt: new Date(now + 300 * DAY) });
		const ledger = new CreditLedgerService(env());
		await ledger.recordUse({ userId: 'u_held', period: p1, pool: 20_000, useKey: 'k_p1', credits: 1_000, source: 'think', model: 'm', usage: null, now: new Date(now - 10 * DAY) });
		await ledger.recordUse({ userId: 'u_held', period: p2, pool: 0, useKey: 'k_p2', credits: 3_000, source: 'think', model: 'm', usage: null, now: new Date(now - DAY) });
		const stripeSub = (status: string) => ({ id: 'sub_held', customer: 'cus_held', status, created: 1, cancel_at_period_end: false, cancel_at: null, metadata: { estori_user_id: 'u_held' }, schedule: null, items: { data: [{ id: 'si_1', price: { id: 'price_pro', metadata: null }, current_period_start: p2.startMs / 1000, current_period_end: p2.endMs / 1000 }] } });
		const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(stripeSub('past_due')));
		await runDailyBilling(env(), now);
		const periods = () => db.prepare("SELECT period_key AS key, pool, settled, closed_at IS NOT NULL AS closed FROM credit_periods WHERE user_id = 'u_held' ORDER BY period_start").all();
		expect((await periods()).results).toEqual([
			{ key: p1.key, pool: 20_000, settled: 0, closed: 1 },
			{ key: p2.key, pool: 0, settled: 0, closed: 0 },
		]);
		fetch.mockImplementation(async () => Response.json(stripeSub('active')));
		const invoice = { id: 'in_held', customer: 'cus_held', amount_paid: 4_900, currency: 'usd', hosted_invoice_url: null, number: 'EST-0010', billing_reason: 'subscription_cycle', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_held' } } };
		const deps = { ...billingEventDepsFromEnv(env()), nowMs: () => now + 3_600_000 };
		expect(await handleBillingEvent(deps, { id: 'evt_held_paid', type: 'invoice.paid', data: { object: invoice } })).toBe('applied');
		expect((await periods()).results[1]).toEqual({ key: p2.key, pool: 20_000, settled: 0, closed: 0 });
		expect(await ledger.settle('u_held', now + DAY)).toBe('nothing');
		expect(await db.prepare("SELECT used FROM credit_purchases WHERE id = 'cp_held'").first('used')).toBe(0);
	});

	it('settles overruns, closes ended periods, expires purchases and forgets old usage', async () => {
		const now = Date.parse('2026-10-19T06:35:00Z');
		await insertUser(db, 'u_day');
		await insertPurchase(db, { id: 'cp_day', userId: 'u_day', credits: 5_000, purchasedAt: new Date(now - 366 * DAY), expiresAt: new Date(now - DAY) });
		const ledger = new CreditLedgerService(env());
		const ended = { key: 'acct:ended', startMs: now - 40 * DAY, endMs: now - 10 * DAY };
		await ledger.recordUse({ userId: 'u_day', period: ended, pool: 5_000, useKey: 'k_old', credits: 6_000, source: 'think', model: 'm', usage: null, now: new Date(now - 100 * DAY) });
		await runDailyBilling(env(), now);
		expect(await db.prepare("SELECT settled, forgiven, closed_at IS NOT NULL AS closed FROM credit_periods WHERE user_id = 'u_day'").first()).toEqual({ settled: 1_000, forgiven: 0, closed: 1 });
		expect(await db.prepare("SELECT used, expired_at IS NOT NULL AS expired FROM credit_purchases WHERE id = 'cp_day'").first()).toEqual({ used: 1_000, expired: 1 });
		expect(await db.prepare("SELECT COUNT(*) AS n FROM credit_uses WHERE user_id = 'u_day'").first()).toEqual({ n: 0 });
	});
});

describe('the hourly billing run', () => {
	it('tells Basic accounts with a verified email that their credits renewed, once, on their day', async () => {
		const now = Date.parse('2026-10-19T10:05:00Z');
		const signedUp = new Date('2026-09-19T08:00:00Z');
		await insertUser(db, 'u_today', { createdAt: signedUp, emailVerified: true });
		await insertUser(db, 'u_unverified', { createdAt: signedUp, emailVerified: false });
		await insertUser(db, 'u_other_day', { createdAt: new Date('2026-09-18T08:00:00Z'), emailVerified: true });
		await insertUser(db, 'u_paying', { createdAt: signedUp, emailVerified: true });
		await insertUser(db, 'u_new', { createdAt: new Date('2026-10-19T09:00:00Z'), emailVerified: true });
		await insertSubscription(db, { userId: 'u_paying', stripeSubscriptionId: 'sub_paying', status: 'active', currentPeriodStart: new Date(now - DAY), currentPeriodEnd: new Date(now + 29 * DAY) });
		await runHourlyBilling(env(), now);
		await runHourlyBilling(env(), now + 3_600_000);
		expect(sent).toHaveLength(1);
		expect(await db.prepare("SELECT user_id FROM billing_notices WHERE kind = 'credits_renewed'").all()).toMatchObject({ results: [{ user_id: 'u_today' }] });
	});

	it("renews an account made on the 31st on a short month's last day, and only for listed accounts while billing is limited", async () => {
		await insertUser(db, 'u_31', { createdAt: new Date('2026-08-31T08:00:00Z'), emailVerified: true });
		await runHourlyBilling(env({ BILLING: undefined, BILLING_USER_IDS: 'someone-else' }), Date.parse('2026-09-30T10:05:00Z'));
		expect(sent).toHaveLength(0);
		await runHourlyBilling(env(), Date.parse('2026-09-30T10:05:00Z'));
		expect(sent).toHaveLength(1);
	});
});
