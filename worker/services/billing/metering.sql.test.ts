/** The credit check before a turn, and charging steps, on real SQL. */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { envWith, insertPurchase, insertSubscription, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { CreditLedgerService } from '../../database/services/CreditLedgerService';
import { loadAccount } from './account';
import { chargeLegacyCall, chargeStep, checkCreditsBeforeTurn, loadTurnAccount, type MeteringDeps } from './metering';

let db: D1Database;
const NOW = Date.parse('2026-10-19T15:00:00Z');
const DAY = 86_400_000;

beforeAll(async () => {
	db = await migratedD1();
});

afterEach(() => vi.restoreAllMocks());

const on = () => envWith(db, { BILLING: 'on' });

async function use(userId: string, credits: number, key = `k_${userId}_${credits}`): Promise<void> {
	const account = await loadAccount(on(), userId, NOW);
	await new CreditLedgerService(on()).recordUse({ userId, period: account.period, pool: account.limits.aiCredits, useKey: key, credits, source: 'think', model: 'm', usage: null, now: new Date(NOW) });
}

describe('checkCreditsBeforeTurn', () => {
	it('checks nothing new while billing is off', async () => {
		await insertUser(db, 'u_off');
		expect(await checkCreditsBeforeTurn(envWith(db), 'u_off', NOW)).toEqual({ billing: false });
	});

	it("starts a turn with any credit left, and refuses with the plan's message once none is", async () => {
		await insertUser(db, 'u_basic', { createdAt: new Date('2026-03-12T09:00:00Z') });
		await use('u_basic', 4_999);
		expect(await checkCreditsBeforeTurn(on(), 'u_basic', NOW)).toEqual({ billing: true, refusal: null });
		await use('u_basic', 1);
		expect(await checkCreditsBeforeTurn(on(), 'u_basic', NOW)).toEqual({
			billing: true,
			refusal: { code: 'plan_limit', limit: 'aiCredits', plan: 'basic', upgradeTo: 'pro', message: "You've used this month's free AI credits. They refill on November 12, or get Pro for 20,000 a month." },
		});
	});

	it('counts extra credits as left, and points Premium at buying more once they are gone', async () => {
		await insertUser(db, 'u_prem');
		await insertSubscription(db, { userId: 'u_prem', stripeSubscriptionId: 'sub_prem', status: 'active', plan: 'premium', currentPeriodStart: new Date(NOW - DAY), currentPeriodEnd: new Date(NOW + 29 * DAY) });
		await insertPurchase(db, { id: 'cp_prem', userId: 'u_prem', credits: 5_000, purchasedAt: new Date(NOW - 2 * DAY), expiresAt: new Date(NOW + 300 * DAY) });
		await use('u_prem', 100_000);
		expect(await checkCreditsBeforeTurn(on(), 'u_prem', NOW)).toEqual({ billing: true, refusal: null });
		await use('u_prem', 5_000);
		expect(await checkCreditsBeforeTurn(on(), 'u_prem', NOW)).toMatchObject({ refusal: { plan: 'premium', upgradeTo: 'credits' } });
	});

	it("tells a seller whose renewal didn't go through to update the card, and still spends bought credits", async () => {
		await insertUser(db, 'u_grace');
		await insertSubscription(db, { userId: 'u_grace', stripeSubscriptionId: 'sub_grace', status: 'past_due', plan: 'pro', currentPeriodStart: new Date(NOW - DAY), currentPeriodEnd: new Date(NOW + 29 * DAY) });
		expect(await checkCreditsBeforeTurn(on(), 'u_grace', NOW)).toEqual({
			billing: true,
			refusal: {
				code: 'plan_limit',
				limit: 'aiCredits',
				plan: 'pro',
				upgradeTo: null,
				paymentFailed: true,
				message: "Your last payment didn't go through, so this month's AI credits haven't started. Pay it on the billing page to keep building.",
			},
		});
		await insertPurchase(db, { id: 'cp_grace', userId: 'u_grace', credits: 5_000, purchasedAt: new Date(NOW - 2 * DAY), expiresAt: new Date(NOW + 300 * DAY) });
		expect(await checkCreditsBeforeTurn(on(), 'u_grace', NOW)).toEqual({ billing: true, refusal: null });
	});
});

describe('chargeStep', () => {
	it('records a step after a passing failure, once, with the same key', async () => {
		await insertUser(db, 'u_retry', { createdAt: new Date('2026-03-12T09:00:00Z') });
		const account = await loadAccount(on(), 'u_retry', NOW);
		const ledger = new CreditLedgerService(on());
		let failures = 1;
		const deps: MeteringDeps = {
			ledger: {
				recordUse: async (input) => {
					if (failures-- > 0) throw new Error('D1_ERROR: network connection lost');
					return ledger.recordUse(input);
				},
			},
			notices: { readBalance: (userId, period, pool) => ledger.readBalance(userId, period, pool), mail: { sender: null, userEmail: async () => null, baseUrl: null, claim: async () => true, release: async () => undefined }, track: async () => undefined },
			now: () => new Date(NOW),
		};
		const charge = { userId: 'u_retry', period: account.period, pool: 5_000, plan: 'basic' as const, useKey: 'agent:turn:1', credits: 165, source: 'think' as const, model: 'anthropic/claude-sonnet-5-5', usage: { inputTokens: 40_000, outputTokens: 3_000 } };
		expect((await chargeStep(deps, charge))?.used).toBe(165);
		expect((await chargeStep(deps, charge))?.used).toBe(165);
		expect(await db.prepare("SELECT credits, input_tokens, output_tokens FROM credit_uses WHERE use_key = 'agent:turn:1'").first()).toEqual({ credits: 165, input_tokens: 40_000, output_tokens: 3_000 });
	});
});

describe('loadTurnAccount', () => {
	it('loads the account a billed turn charges after a passing failure, so the turn is never free', async () => {
		await insertUser(db, 'u_turn', { createdAt: new Date('2026-03-12T09:00:00Z') });
		let failures = 2;
		const flaky: typeof loadAccount = async (env, userId, nowMs) => {
			if (failures-- > 0) throw new Error('D1_ERROR: network connection lost');
			return loadAccount(env, userId, nowMs ?? NOW);
		};
		const account = await loadTurnAccount(on(), 'u_turn', flaky);
		expect(account).toMatchObject({ plan: 'basic', pool: 5_000, period: { key: (await loadAccount(on(), 'u_turn', NOW)).period.key } });
	});

	it('answers null and logs the account at error level once every try fails', async () => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		let tries = 0;
		const down: typeof loadAccount = async () => {
			tries += 1;
			throw new Error('D1_ERROR: network connection lost');
		};
		expect(await loadTurnAccount(on(), 'u_down', down)).toBeNull();
		expect(tries).toBe(3);
		expect(errorLog).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(errorLog.mock.calls[0])).toContain('u_down');
	});
});

describe('chargeLegacyCall', () => {
	it("charges an older AI call its old flat cost in the new unit, and leaves it to today's counter while billing is off", async () => {
		await insertUser(db, 'u_infer', { createdAt: new Date('2026-03-12T09:00:00Z') });
		expect(await chargeLegacyCall(envWith(db), { userId: 'u_infer', model: 'anthropic/claude-sonnet-5-5', creditCost: 8 })).toBe(false);
		expect(await chargeLegacyCall(on(), { userId: 'u_infer', model: 'anthropic/claude-sonnet-5-5', creditCost: 8 })).toBe(true);
		expect(await db.prepare("SELECT credits, source FROM credit_uses WHERE user_id = 'u_infer'").first()).toEqual({ credits: 136, source: 'infer' });
	});
});
