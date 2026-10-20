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
	await insertSubscription(db, { userId: 'u_sub', stripeSubscriptionId: 'sub_1', status: 'active', plan: 'premium', currentPeriodStart: new Date('2026-10-05T10:00:00Z'), currentPeriodEnd: new Date('2026-11-05T10:00:00Z') });
});

describe('loadAccount', () => {
	it("resolves a subscriber's plan, limits and Stripe period", async () => {
		const account = await loadAccount(envWith(db, { BILLING: 'on' }), 'u_sub', NOW);
		expect(account).toMatchObject({ billing: true, plan: 'premium', source: 'subscription', creditsResetAt: Date.parse('2026-11-05T10:00:00Z'), limits: { aiCredits: 100_000, liveStores: 10, extraCredits: true } });
		expect(account.period.key).toBe(`sub:sub_1:${Date.parse('2026-10-05T10:00:00Z') / 1000}`);
	});

	it("gives Basic its month from the sign-up date and reads its credits from the ledger", async () => {
		const env = envWith(db, { BILLING: 'on' });
		const account = await loadAccount(env, 'u_basic', NOW);
		expect(account).toMatchObject({ plan: 'basic', limits: { aiCredits: 5_000, storesLifetime: 3 }, period: { startMs: Date.parse('2026-10-12T00:00:00Z'), endMs: Date.parse('2026-11-12T00:00:00Z') } });
		await new CreditLedgerService(env).recordUse({ userId: 'u_basic', period: account.period, pool: 5_000, useKey: 'k1', credits: 1_200, source: 'think', model: 'm', usage: null, now: new Date(NOW) });
		expect(await loadCredits(env, account)).toMatchObject({ used: 1_200, left: 3_800 });
	});

	it("treats everyone as today's Basic while billing is off, without reading the billing tables, and honors the user list", async () => {
		expect(await loadAccount(envWith(db), 'u_sub', NOW)).toMatchObject({ billing: false, plan: 'basic', source: 'free', subscription: null, limits: { liveStores: null, supplierCatalog: true } });
		expect((await loadAccount(envWith(db, { BILLING_USER_IDS: 'someone-else, u_sub' }), 'u_sub', NOW)).plan).toBe('premium');
	});
});
