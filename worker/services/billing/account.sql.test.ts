import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertSubscription, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { CreditLedgerService } from '../../database/services/CreditLedgerService';
import { loadAccount, loadCredits } from './account';

const NOW = Date.parse('2026-10-19T15:00:00Z');
let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'u_sub', { createdAt: new Date('2026-03-12T09:00:00Z') });
	await insertUser(db, 'u_basic', { createdAt: new Date('2026-03-12T09:00:00Z') });
	await insertUser(db, 'u_late', { createdAt: new Date('2026-03-12T09:00:00Z') });
	await insertSubscription(db, { userId: 'u_late', stripeSubscriptionId: 'sub_late', status: 'past_due', plan: 'pro', currentPeriodStart: new Date('2026-10-17T10:00:00Z'), currentPeriodEnd: new Date('2026-11-17T10:00:00Z') });
	await insertSubscription(db, { userId: 'u_sub', stripeSubscriptionId: 'sub_1', status: 'active', plan: 'premium', currentPeriodStart: new Date('2026-10-05T10:00:00Z'), currentPeriodEnd: new Date('2026-11-05T10:00:00Z') });
});

describe('loadAccount', () => {
	it("resolves a subscriber's plan, limits and Stripe period", async () => {
		const account = await loadAccount(envWith(db, { BILLING: 'on' }), 'u_sub', NOW);
		expect(account).toMatchObject({ billing: true, plan: 'premium', source: 'subscription', creditsResetAt: Date.parse('2026-11-05T10:00:00Z'), limits: { aiCredits: 100_000, liveStores: 20, extraCredits: true } });
		expect(account.period.key).toBe(`sub:sub_1:${Date.parse('2026-10-05T10:00:00Z') / 1000}`);
	});

	it('keeps a late payer on its plan with no monthly credits until the renewal is paid', async () => {
		const env = envWith(db, { BILLING: 'on' });
		const account = await loadAccount(env, 'u_late', NOW);
		expect(account).toMatchObject({ plan: 'pro', source: 'subscription', graceEndsAtMs: Date.parse('2026-10-24T10:00:00Z'), limits: { aiCredits: 0, liveStores: 5, supplierCatalog: true } });
		expect(await loadCredits(env, account)).toMatchObject({ pool: 0, poolLeft: 0, left: 0 });
	});

	it("gives Basic its month from the sign-up date and reads its credits from the ledger", async () => {
		const env = envWith(db, { BILLING: 'on' });
		const account = await loadAccount(env, 'u_basic', NOW);
		expect(account).toMatchObject({ plan: 'basic', limits: { aiCredits: 5_000, storesLifetime: 2 }, period: { startMs: Date.parse('2026-10-12T00:00:00Z'), endMs: Date.parse('2026-11-12T00:00:00Z') } });
		await new CreditLedgerService(env).recordUse({ userId: 'u_basic', period: account.period, pool: 5_000, useKey: 'k1', credits: 1_200, source: 'think', model: 'm', usage: null, now: new Date(NOW) });
		expect(await loadCredits(env, account)).toMatchObject({ used: 1_200, left: 3_800 });
	});

	it("treats everyone as today's Basic while billing is off, without reading the billing tables, and honors the user list", async () => {
		expect(await loadAccount(envWith(db), 'u_sub', NOW)).toMatchObject({ billing: false, plan: 'basic', source: 'free', subscription: null, limits: { liveStores: null, supplierCatalog: true } });
		expect((await loadAccount(envWith(db, { BILLING_USER_IDS: 'someone-else, u_sub' }), 'u_sub', NOW)).plan).toBe('premium');
	});
});

it('refreshes a yearly subscriber’s monthly credit pool while keeping the annual cancellation date', async () => {
 await insertUser(db, 'u_year');
 const env = envWith(db, { BILLING: 'on' });
 const start = new Date('2026-01-31T15:30:00Z');
 const end = new Date('2027-01-31T15:30:00Z');
 await insertSubscription(db, { userId: 'u_year', stripeSubscriptionId: 'sub_year', status: 'active', plan: 'pro', billingInterval: 'year', currentPeriodStart: start, currentPeriodEnd: end, cancelAtPeriodEnd: true });
 const jan = await loadAccount(env, 'u_year', Date.parse('2026-02-15T15:30:00Z'));
 const ledger = new CreditLedgerService(env);
 await ledger.recordUse({ userId: 'u_year', period: jan.period, pool: jan.limits.aiCredits, useKey: 'year-first-month', credits: 20000, source: 'think', model: 'm', usage: null, now: new Date('2026-02-15T15:30:00Z') });
 expect(await loadCredits(env, jan)).toMatchObject({ pool: 20000, left: 0 });
 const feb = await loadAccount(env, 'u_year', Date.parse('2026-02-28T15:30:00Z'));
 expect(feb.creditsResetAt).toBe(Date.parse('2026-03-31T15:30:00Z'));
 expect(await loadCredits(env, feb)).toMatchObject({ pool: 20000, left: 20000, used: 0 });
 expect(feb.subscription?.currentPeriodEnd).toEqual(end);
});

it('refreshes the selected monthly allowance within an annual subscription without creating a one-time purchase', async () => {
 await insertUser(db,'u_allowance');
 const config=envWith(db,{BILLING:'on'});
 await insertSubscription(db,{userId:'u_allowance',stripeSubscriptionId:'sub_allowance',status:'active',plan:'pro',billingInterval:'year',monthlyCredits:30000,currentPeriodStart:new Date('2026-01-31T10:00:00Z'),currentPeriodEnd:new Date('2027-01-31T10:00:00Z')});
 const jan=await loadAccount(config,'u_allowance',Date.parse('2026-02-15T00:00:00Z'));
 expect(jan.limits.aiCredits).toBe(30000);
 await new CreditLedgerService(config).recordUse({userId:'u_allowance',period:jan.period,pool:jan.limits.aiCredits,useKey:'custom-usage',credits:30000,source:'think',model:'m',usage:null,now:new Date('2026-02-15T00:00:00Z')});
 expect(await loadCredits(config,jan)).toMatchObject({left:0,pool:30000});
 const feb=await loadAccount(config,'u_allowance',Date.parse('2026-02-28T10:00:00Z'));
 expect(await loadCredits(config,feb)).toMatchObject({left:30000,pool:30000,used:0});
 expect(await new CreditLedgerService(config).purchasesOf('u_allowance')).toHaveLength(0);
});
