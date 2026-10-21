/** Resuming tasks that paused for credits, and charging a task's calls to the ledger, on real SQL. */

import { beforeAll, describe, expect, it } from 'vitest';
import { TASK_MODEL_ID } from '../../../shared/types/store-translations';
import { CreditLedgerService } from '../../database/services/CreditLedgerService';
import { TaskService, type TaskRecord } from '../../database/services/TaskService';
import { envWith, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { loadAccount } from '../billing/account';
import { resumeCreditPausedTasks, taskMeterFromEnv } from './task-meter';

let db: D1Database;
const NOW = Date.now();
const SELLERS = ['seller_credits', 'seller_empty', 'seller_progress', 'seller_charge', 'seller_daily'];
const DAY = 86_400_000;

beforeAll(async () => {
	db = await migratedD1();
	for (const id of SELLERS) await insertUser(db, id);
});

function fakeRunners() {
	const woken: string[] = [];
	const namespace = {
		idFromName: (name: string) => name,
		get: () => ({
			wake: async (userId: string) => {
				woken.push(userId);
			},
		}),
	};
	return { runners: namespace as unknown as Env['TASK_RUNNER'], woken };
}

const billed = (extra: Record<string, unknown> = {}) => envWith(db, { BILLING: 'on', ...extra });
const tasks = () => new TaskService(envWith(db));

async function queuePaused(userId: string, key: string, reason: 'credits' | 'seller'): Promise<TaskRecord> {
	const result = await tasks().enqueue({ userId, appId: null, kind: 'store.translate', payload: {}, dedupeKey: key });
	if (!('task' in result)) throw new Error('Refused');
	await tasks().pause(result.task.id, reason);
	return result.task;
}

async function statusOf(userId: string, id: string): Promise<TaskRecord | undefined> {
	return (await tasks().listForUser(userId, { limit: 100 })).find((task) => task.id === id);
}

async function spend(userId: string, credits: number): Promise<void> {
	const account = await loadAccount(billed(), userId, NOW);
	await new CreditLedgerService(billed()).recordUse({ userId, period: account.period, pool: account.limits.aiCredits, useKey: `spend:${userId}:${credits}`, credits, source: 'think', model: 'm', usage: null, now: new Date(NOW) });
}

describe('resumeCreditPausedTasks', () => {
	it('resumes the tasks of a seller with credits again and wakes their runner, and leaves a seller with none paused', async () => {
		const first = await queuePaused('seller_credits', 'store.translate:app_a:es', 'credits');
		const second = await queuePaused('seller_credits', 'store.translate:app_a:pt-BR', 'credits');
		const byChoice = await queuePaused('seller_credits', 'store.translate:app_b:es', 'seller');
		const stuck = await queuePaused('seller_empty', 'store.translate:app_c:es', 'credits');
		await spend('seller_empty', 5_000);
		const { runners, woken } = fakeRunners();

		expect(await resumeCreditPausedTasks(billed({ TASK_RUNNER: runners }))).toBe(2);

		expect((await statusOf('seller_credits', first.id))?.status).toBe('queued');
		expect((await statusOf('seller_credits', second.id))?.status).toBe('queued');
		expect(await statusOf('seller_credits', byChoice.id)).toMatchObject({ status: 'paused', pauseReason: 'seller' });
		expect(await statusOf('seller_empty', stuck.id)).toMatchObject({ status: 'paused', pauseReason: 'credits' });
		expect(woken).toEqual(['seller_credits']);

		// Nothing is left to resume, so the next run wakes nobody.
		expect(await resumeCreditPausedTasks(billed({ TASK_RUNNER: runners }))).toBe(0);
		expect(woken).toEqual(['seller_credits']);
	});

	it('keeps the steps a task saved, so resuming continues where it stopped', async () => {
		const queued = await queuePaused('seller_progress', 'store.translate:app_d:es', 'seller');
		await tasks().resume(queued.id, 'seller_progress', NOW);
		const claimed = await tasks().claimNext('seller_progress', NOW, 120_000);
		if (!claimed) throw new Error('Not claimed');
		await tasks().saveStep(claimed.id, { progress: { done: 40, total: 120, skipped: 0 }, credits: 7, steps: 1, finished: false }, NOW);
		await tasks().pause(claimed.id, 'credits');
		const { runners } = fakeRunners();

		expect(await resumeCreditPausedTasks(billed({ TASK_RUNNER: runners }))).toBe(1);
		expect(await statusOf('seller_progress', claimed.id)).toMatchObject({ status: 'queued', pauseReason: null, steps: 1, creditsUsed: 7, progress: { done: 40, total: 120, skipped: 0 } });
	});
});

describe('the task meter on the ledger', () => {
	it('charges a step once however often it is charged, and the gate refuses once the credits are spent', async () => {
		const meter = taskMeterFromEnv(billed());
		const call = { model: TASK_MODEL_ID, usage: { inputTokens: 1_000, outputTokens: 500 } };
		const step = { userId: 'seller_charge', taskId: 'task_1', step: 0, calls: [call, call] };

		expect(await meter.gate('seller_charge')).toEqual({ ok: true });
		expect(await meter.charge(step)).toBe(8);
		expect(await meter.charge(step)).toBe(8);

		const uses = await db.prepare("SELECT use_key AS key, credits, source, model FROM credit_uses WHERE user_id = 'seller_charge' ORDER BY use_key").all();
		expect(uses.results).toEqual([
			{ key: 'task:task_1:0:0', credits: 4, source: 'task', model: TASK_MODEL_ID },
			{ key: 'task:task_1:0:1', credits: 4, source: 'task', model: TASK_MODEL_ID },
		]);
		expect(await db.prepare("SELECT used FROM credit_periods WHERE user_id = 'seller_charge'").first('used')).toBe(8);

		await spend('seller_charge', 5_000);
		expect(await meter.gate('seller_charge')).toEqual({ ok: false, reason: 'credits', resumeAt: null });
	});
});

describe('the task meter with billing off', () => {
	it("counts a task's calls against the daily bucket the agent uses, and holds the task until the next UTC day once it is spent", async () => {
		let used = 198;
		const counter = {
			increment: async (_key: string, config: { limit: number }, by: number) => {
				if (used >= config.limit) return { success: false };
				used += by;
				return { success: true };
			},
			getRemainingLimit: async (_key: string, config: { limit: number }) => Math.max(0, config.limit - used),
		};
		const env = envWith(db, { DORateLimitStore: { getByName: () => counter }, VibecoderStore: { get: async () => null } });
		const meter = taskMeterFromEnv(env);

		expect(await meter.gate('seller_daily')).toEqual({ ok: true });
		const credits = await meter.charge({ userId: 'seller_daily', taskId: 'task_2', step: 0, calls: [{ model: TASK_MODEL_ID, usage: { inputTokens: 1_000, outputTokens: 500 } }] });
		// The seller sees the call's cost at the model's prices; the old bucket takes the model's flat 3.
		expect(credits).toBe(4);
		expect(used).toBe(201);
		const gate = await meter.gate('seller_daily');
		expect(gate).toMatchObject({ ok: false, reason: 'daily-limit' });
		const resumeAt = gate.ok ? 0 : (gate.resumeAt ?? 0);
		expect(resumeAt % DAY).toBe(0);
		expect(resumeAt).toBeGreaterThan(Date.now());
		expect(resumeAt - Date.now()).toBeLessThanOrEqual(DAY);
		expect(await db.prepare("SELECT count(*) AS n FROM credit_uses WHERE user_id = 'seller_daily'").first('n')).toBe(0);
	});
});
