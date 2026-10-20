/** The credit ledger on real SQL: each step charged once, concurrent steps all counted, overruns settled once, expiries and closes in order. */

import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertPurchase, insertUser, migratedD1 } from '../test-support/real-d1';
import { CreditLedgerService, type RecordUseInput } from './CreditLedgerService';

let db: D1Database;
const DAY = 86_400_000;
const START = Date.parse('2026-10-05T00:00:00Z');
const PERIOD = { key: `acct:${START / 1000}`, startMs: START, endMs: START + 31 * DAY };

beforeAll(async () => {
	db = await migratedD1();
	for (const id of ['u_once', 'u_race', 'u_buy', 'u_settle', 'u_expire', 'u_close', 'u_late']) await insertUser(db, id);
});

function use(userId: string, useKey: string, credits: number, overrides: Partial<RecordUseInput> = {}): RecordUseInput {
	return { userId, period: PERIOD, pool: 5_000, useKey, credits, source: 'think', model: 'anthropic/claude-sonnet-5-5', usage: { inputTokens: 40_000, outputTokens: 3_000 }, now: new Date(START + DAY), ...overrides };
}

async function purchaseUsed(id: string): Promise<unknown> {
	return (await db.prepare('SELECT used FROM credit_purchases WHERE id = ?').bind(id).first())?.used;
}

describe('the credit ledger', () => {
	it('charges a step once however often it is recorded', async () => {
		const ledger = new CreditLedgerService(envWith(db));
		await ledger.recordUse(use('u_once', 'agent:turn:1', 165));
		const again = await ledger.recordUse(use('u_once', 'agent:turn:1', 165));
		expect(again.used).toBe(165);
		expect(await db.prepare("SELECT COUNT(*) AS n FROM credit_uses WHERE user_id = 'u_once'").first()).toEqual({ n: 1 });
	});

	it('counts every step when two stores build at once', async () => {
		const ledger = new CreditLedgerService(envWith(db));
		await Promise.all(Array.from({ length: 10 }, (_, index) => ledger.recordUse(use('u_race', `store-${index % 2}:turn:${index}`, 100))));
		expect((await ledger.readBalance('u_race', PERIOD, 5_000)).used).toBe(1_000);
	});

	it('spends the pool and grants first, then purchases, and reads it back exactly', async () => {
		const ledger = new CreditLedgerService(envWith(db));
		await ledger.addGrant({ userId: 'u_buy', period: PERIOD, pool: 5_000, credits: 1_000, adminUserId: 'u_once', reason: 'Partner', now: new Date(START) });
		await insertPurchase(db, { id: 'cp_buy_old', userId: 'u_buy', credits: 5_000, purchasedAt: new Date(START - 10 * DAY), expiresAt: new Date(START + 355 * DAY) });
		await ledger.recordUse(use('u_buy', 'k1', 8_000));
		expect(await ledger.readBalance('u_buy', PERIOD, 5_000)).toEqual({ pool: 5_000, granted: 1_000, used: 8_000, poolLeft: 0, purchasedLeft: 3_000, left: 3_000, available: 11_000 });
	});

	it('settles an overrun once, oldest purchase first, even when two runs race', async () => {
		const ledger = new CreditLedgerService(envWith(db));
		await insertPurchase(db, { id: 'cp_s_new', userId: 'u_settle', credits: 5_000, purchasedAt: new Date(START - DAY), expiresAt: new Date(START + 364 * DAY) });
		await insertPurchase(db, { id: 'cp_s_old', userId: 'u_settle', credits: 2_000, purchasedAt: new Date(START - 5 * DAY), expiresAt: new Date(START + 360 * DAY) });
		await ledger.recordUse(use('u_settle', 'k1', 8_000));
		const results = await Promise.all([ledger.settle('u_settle', START + 2 * DAY), ledger.settle('u_settle', START + 2 * DAY)]);
		// The second run either lost the race or came after; either way it took nothing.
		expect(results.filter((result) => result === 'settled')).toHaveLength(1);
		expect([await purchaseUsed('cp_s_old'), await purchaseUsed('cp_s_new')]).toEqual([2_000, 1_000]);
		expect(await ledger.settle('u_settle', START + 2 * DAY)).toBe('nothing');
		expect((await ledger.readBalance('u_settle', PERIOD, 5_000)).purchasedLeft).toBe(4_000);
	});

	it('takes usage from a purchase before it expires, then drops what is left of it', async () => {
		const ledger = new CreditLedgerService(envWith(db));
		await insertPurchase(db, { id: 'cp_e_old', userId: 'u_expire', credits: 5_000, purchasedAt: new Date(START - 360 * DAY), expiresAt: new Date(START + 5 * DAY) });
		await insertPurchase(db, { id: 'cp_e_new', userId: 'u_expire', credits: 5_000, purchasedAt: new Date(START - DAY), expiresAt: new Date(START + 364 * DAY) });
		await ledger.recordUse(use('u_expire', 'k1', 8_000));
		expect(await ledger.usersToSettle(START + 6 * DAY, 100)).toContain('u_expire');
		await ledger.settle('u_expire', START + 6 * DAY);
		expect(await ledger.expirePurchases('u_expire', START + 6 * DAY)).toBe(1);
		expect([await purchaseUsed('cp_e_old'), await purchaseUsed('cp_e_new')]).toEqual([3_000, 0]);
		expect((await ledger.readBalance('u_expire', PERIOD, 5_000)).purchasedLeft).toBe(5_000);
	});

	it('closes an ended period, forgiving what no purchase covers, so the next period starts clean', async () => {
		const ledger = new CreditLedgerService(envWith(db));
		await insertPurchase(db, { id: 'cp_c', userId: 'u_close', credits: 5_000, purchasedAt: new Date(START - DAY), expiresAt: new Date(START + 364 * DAY) });
		await ledger.recordUse(use('u_close', 'k1', 12_000));
		await ledger.settle('u_close', PERIOD.endMs + 1);
		expect(await db.prepare("SELECT settled, forgiven, closed_at IS NOT NULL AS closed FROM credit_periods WHERE user_id = 'u_close'").first()).toEqual({ settled: 5_000, forgiven: 2_000, closed: 1 });
		const next = { key: `acct:${PERIOD.endMs / 1000}`, startMs: PERIOD.endMs, endMs: PERIOD.endMs + 30 * DAY };
		expect(await ledger.readBalance('u_close', next, 5_000)).toMatchObject({ used: 0, poolLeft: 5_000, purchasedLeft: 0, left: 5_000 });
	});

	it('logs a step that arrives after its period closed without charging it', async () => {
		const ledger = new CreditLedgerService(envWith(db));
		await ledger.recordUse(use('u_late', 'k1', 100));
		await ledger.settle('u_late', PERIOD.endMs + 1);
		expect((await ledger.recordUse(use('u_late', 'k2', 100))).used).toBe(100);
		expect(await db.prepare("SELECT COUNT(*) AS n FROM credit_uses WHERE user_id = 'u_late'").first()).toEqual({ n: 2 });
	});

	it('audits grants, lists unexpired purchases oldest first, finds one by its payment, and prunes old uses', async () => {
		const ledger = new CreditLedgerService(envWith(db));
		await insertUser(db, 'u_house');
		await ledger.addGrant({ userId: 'u_house', period: PERIOD, pool: 5_000, credits: 500, adminUserId: 'u_once', reason: 'Support', now: new Date(START) });
		expect((await ledger.grantsOf('u_house', PERIOD.key)).map((grant) => [grant.credits, grant.adminUserId, grant.reason])).toEqual([[500, 'u_once', 'Support']]);
		expect(await db.prepare("SELECT user_id, entity_type, action FROM audit_logs WHERE entity_id = 'u_house'").first()).toEqual({ user_id: 'u_once', entity_type: 'credit_grant', action: 'credit_grant' });

		await insertPurchase(db, { id: 'cp_h_new', userId: 'u_house', credits: 5_000, purchasedAt: new Date(START - DAY), expiresAt: new Date(START + 364 * DAY) });
		await insertPurchase(db, { id: 'cp_h_old', userId: 'u_house', credits: 5_000, purchasedAt: new Date(START - 2 * DAY), expiresAt: new Date(START + 363 * DAY) });
		await insertPurchase(db, { id: 'cp_h_gone', userId: 'u_house', credits: 5_000, purchasedAt: new Date(START - 400 * DAY), expiresAt: new Date(START - 35 * DAY) });
		expect(await ledger.expirePurchases('u_house', START)).toBe(1);
		expect((await ledger.purchasesOf('u_house')).map((purchase) => purchase.id)).toEqual(['cp_h_old', 'cp_h_new']);
		expect((await ledger.purchaseByPaymentIntent('pi_cp_h_new'))?.id).toBe('cp_h_new');
		expect(await ledger.purchaseByPaymentIntent('pi_missing')).toBeNull();

		await ledger.recordUse(use('u_house', 'house:old', 10, { now: new Date(START - 100 * DAY) }));
		await ledger.recordUse(use('u_house', 'house:new', 10));
		await ledger.pruneUses(START - 90 * DAY);
		expect((await db.prepare("SELECT use_key FROM credit_uses WHERE user_id = 'u_house'").all()).results).toEqual([{ use_key: 'house:new' }]);
	});
});
