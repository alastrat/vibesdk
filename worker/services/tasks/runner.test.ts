import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
	TASK_FAILED_MESSAGE,
	TASK_LEASE_MS,
	TASK_MAX_FAILURES,
	TASK_RETRY_DELAYS_MS,
	TASK_RETRY_MESSAGE,
	taskRetryAt,
	type TaskPauseReason,
} from '../../../shared/types/tasks';
import type { TaskRecord } from '../../database/services/TaskService';
import type { ModelCall, TaskKindHandler, TaskStepContext, TaskStepResult } from './kinds';
import type { MeterGate, TaskMeter } from './meter';
import { runTaskTick, type TaskStore } from './runner';

const NOW = 1_800_000_000_000;
const ENV = {} as Env;
const CALL: ModelCall = { model: 'google-ai-studio/gemini-3.6-flash', usage: { inputTokens: 1200, outputTokens: 900 } };

let errorLog: MockInstance<typeof console.error>;
beforeEach(() => {
	errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
	errorLog.mockRestore();
});

function task(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
	return {
		id,
		userId: 'seller_1',
		appId: 'app_1',
		kind: 'store.translate',
		status: 'queued',
		payload: { appId: 'app_1', locale: 'es' },
		progress: { done: 0, total: 0, skipped: 0 },
		creditsUsed: 0,
		attempts: 0,
		steps: 0,
		lastError: null,
		pauseReason: null,
		runAt: NOW,
		leaseUntil: null,
		dedupeKey: `store.translate:app_1:${id}`,
		createdAt: NOW,
		startedAt: null,
		finishedAt: null,
		...overrides,
	};
}

/** The queue's rules in memory, as TaskService applies them in SQL. */
function memoryStore(initial: TaskRecord[]) {
	const tasks = new Map(initial.map((record) => [record.id, { ...record }]));
	const get = (id: string): TaskRecord => {
		const record = tasks.get(id);
		if (!record) throw new Error(`No task ${id}`);
		return record;
	};
	const leased = (userId: string, now: number) => [...tasks.values()].some((record) => record.userId === userId && record.status === 'running' && (record.leaseUntil ?? 0) > now);
	const claimable = (record: TaskRecord) => record.status === 'queued' || record.status === 'running';
	const failing = { saveStep: 0, recordFailure: 0 };
	const unavailable = (method: keyof typeof failing) => {
		if (failing[method] === 0) return;
		failing[method] -= 1;
		throw new Error('D1 is unavailable');
	};

	const store: TaskStore = {
		async claimNext(userId, now, leaseMs) {
			if (leased(userId, now)) return null;
			const [next] = [...tasks.values()]
				.filter((record) => record.userId === userId && claimable(record) && record.runAt <= now)
				.sort((a, b) => a.runAt - b.runAt || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
			if (!next) return null;
			Object.assign(next, { status: 'running', leaseUntil: now + leaseMs, startedAt: next.startedAt ?? now, pauseReason: null });
			return { ...next };
		},
		async saveStep(id, step, now) {
			unavailable('saveStep');
			const record = get(id);
			if (record.steps !== step.steps - 1) return null;
			Object.assign(record, { progress: step.progress, creditsUsed: record.creditsUsed + step.credits, steps: step.steps, leaseUntil: null, runAt: now });
			if (!step.finished) Object.assign(record, { attempts: 0, lastError: null });
			return record.status;
		},
		async finish(id, now) {
			const record = get(id);
			if (record.status !== 'running') return null;
			Object.assign(record, { status: 'done', finishedAt: now, leaseUntil: null, pauseReason: null, attempts: 0, lastError: null });
			return { ...record };
		},
		async fail(id, message, now) {
			const record = get(id);
			if (record.status !== 'running') return null;
			Object.assign(record, { status: 'failed', lastError: message, finishedAt: now, leaseUntil: null });
			return { ...record };
		},
		async recordFailure(id, messages, now) {
			unavailable('recordFailure');
			const record = get(id);
			if (record.status !== 'running') return null;
			const failures = record.attempts + 1;
			const retryAt = taskRetryAt(failures, now);
			if (retryAt === null) {
				Object.assign(record, { status: 'failed', attempts: failures, lastError: messages.failed, finishedAt: now, leaseUntil: null });
			} else {
				Object.assign(record, { status: 'queued', attempts: failures, lastError: messages.retry, runAt: retryAt, leaseUntil: null });
			}
			return { ...record };
		},
		async pause(id, reason) {
			const record = get(id);
			if (claimable(record)) Object.assign(record, { status: 'paused', pauseReason: reason, leaseUntil: null, startedAt: record.steps === 0 ? null : record.startedAt });
		},
		async defer(id, runAt, reason) {
			const record = get(id);
			if (claimable(record)) Object.assign(record, { status: 'queued', runAt, pauseReason: reason, leaseUntil: null, startedAt: record.steps === 0 ? null : record.startedAt });
		},
		async nextRunAt(userId) {
			const live = [...tasks.values()].filter((record) => record.userId === userId && claimable(record));
			if (live.length === 0) return null;
			return Math.max(Math.min(...live.map((record) => record.runAt)), ...live.map((record) => record.leaseUntil ?? 0));
		},
	};

	return {
		store,
		task: get,
		/** What the seller's Resume does. */
		resume(id: string, now: number) {
			Object.assign(get(id), { status: 'queued', pauseReason: null, attempts: 0, lastError: null, finishedAt: null, leaseUntil: null, runAt: now });
		},
		/** What the seller's Cancel does. */
		cancel(id: string, now: number) {
			Object.assign(get(id), { status: 'canceled', finishedAt: now, leaseUntil: null });
		},
		failNext(method: keyof typeof failing, count: number) {
			failing[method] = count;
		},
	};
}

type Payload = { appId: string; locale: string };
type Scripted = TaskStepResult | Error | ((ctx: TaskStepContext) => TaskStepResult);

function fakeKind(script: Scripted[], options: { onFinished?: (ctx: TaskStepContext) => void; describeError?: (error: unknown) => string; hold?: (ctx: TaskStepContext) => number | null } = {}) {
	const stepped: Array<{ taskId: string; now: number; payload: Payload }> = [];
	const finished: string[] = [];
	const finishedWith: Array<TaskStepResult | undefined> = [];
	const handler: TaskKindHandler<Payload> = {
		kind: 'store.translate',
		parsePayload(raw) {
			if (typeof raw !== 'object' || raw === null) return null;
			const { appId, locale } = raw as Record<string, unknown>;
			return typeof appId === 'string' && typeof locale === 'string' ? { appId, locale } : null;
		},
		async step(ctx, payload) {
			stepped.push({ taskId: ctx.task.id, now: ctx.now, payload });
			const next = script.length > 1 ? script.shift() : script[0];
			if (!next) throw new Error('No scripted step');
			if (next instanceof Error) throw next;
			return typeof next === 'function' ? next(ctx) : next;
		},
		async onFinished(ctx, _payload, result) {
			finished.push(ctx.task.id);
			finishedWith.push(result);
			options.onFinished?.(ctx);
		},
		describeError: options.describeError,
		hold: options.hold === undefined ? undefined : async (ctx) => options.hold?.(ctx) ?? null,
	};
	return { handler, stepped, finished, finishedWith };
}

function fakeMeter(gates: MeterGate[] = [], options: { chargeFails?: boolean; gateFails?: boolean } = {}) {
	const charges: Array<{ userId: string; taskId: string; step: number; calls: ModelCall[] }> = [];
	let gated = 0;
	const meter: TaskMeter = {
		async gate() {
			gated += 1;
			if (options.gateFails) throw new Error('The ledger is unavailable');
			return gates.shift() ?? { ok: true };
		},
		async charge(input) {
			if (options.chargeFails) throw new Error('The ledger is unavailable');
			charges.push(input);
			return input.calls.length * 7;
		},
	};
	return { meter, charges, gated: () => gated };
}

function setup(tasks: TaskRecord[], script: Scripted[], gates: MeterGate[] = [], options: Parameters<typeof fakeKind>[1] & Parameters<typeof fakeMeter>[1] = {}) {
	const memory = memoryStore(tasks);
	const kind = fakeKind(script, options);
	const metering = fakeMeter(gates, options);
	const ended: TaskRecord[] = [];
	const deps = { store: memory.store, meter: metering.meter, kinds: (name: string) => (name === kind.handler.kind ? kind.handler : null), env: ENV, ended: (record: TaskRecord) => void ended.push(record) };
	return { ...memory, ...kind, ...metering, ended, tick: (now: number) => runTaskTick(deps, 'seller_1', now) };
}

/** Ticks at each alarm the runner asks for until it asks for none, or `limit` ticks. */
async function runUntilIdle(queue: ReturnType<typeof setup>, from: number, limit = 20): Promise<{ ticks: number; now: number }> {
	let now = from;
	for (let ticks = 1; ticks <= limit; ticks += 1) {
		const { nextAlarmAt } = await queue.tick(now);
		if (nextAlarmAt === null) return { ticks, now };
		now = nextAlarmAt;
	}
	return { ticks: limit, now };
}

const progress = (done: number, total: number, skipped = 0) => ({ done, total, skipped });
const stepOf = (done: number, total: number, finished = false, calls: ModelCall[] = [CALL]): TaskStepResult => ({ progress: progress(done, total), finished, calls });

describe('runTaskTick', () => {
	it('runs one step of the next due task and saves its progress', async () => {
		const queue = setup([task('later', { runAt: NOW - 1_000 }), task('first', { runAt: NOW - 5_000 })], [stepOf(40, 100)]);

		const result = await queue.tick(NOW);

		expect(queue.stepped).toEqual([{ taskId: 'first', now: NOW, payload: { appId: 'app_1', locale: 'es' } }]);
		expect(queue.task('first')).toMatchObject({ status: 'running', progress: progress(40, 100), steps: 1, creditsUsed: 7, leaseUntil: null, startedAt: NOW });
		expect(queue.task('later')).toMatchObject({ status: 'queued', steps: 0, startedAt: null });
		// More work is due, so the runner goes again at once.
		expect(result.nextAlarmAt).toBe(NOW);
	});

	it('holds a task its kind will not run now: no credit check, no step, no charge, and it comes back at the time the kind named', async () => {
		let holdUntil: number | null = NOW + 15 * 60_000;
		const queue = setup([task('a')], [stepOf(40, 100)], [], { hold: () => holdUntil });

		const held = await queue.tick(NOW);

		expect(held).toEqual({ nextAlarmAt: NOW + 15 * 60_000 });
		expect(queue.stepped).toEqual([]);
		expect(queue.gated()).toBe(0);
		expect(queue.charges).toEqual([]);
		// Back to waiting, as before its first claim: no step, no credits, no start time, no reason to show.
		expect(queue.task('a')).toMatchObject({ status: 'queued', runAt: NOW + 15 * 60_000, steps: 0, creditsUsed: 0, attempts: 0, startedAt: null, pauseReason: null, leaseUntil: null });

		// Not due yet, so nothing runs; once the hold is lifted, the task takes its first step.
		expect(await queue.tick(NOW + 60_000)).toEqual({ nextAlarmAt: NOW + 15 * 60_000 });
		holdUntil = null;
		await queue.tick(NOW + 15 * 60_000);
		expect(queue.stepped.map((step) => step.taskId)).toEqual(['a']);
		expect(queue.task('a')).toMatchObject({ steps: 1, creditsUsed: 7, progress: progress(40, 100) });
	});

	it('asks the kind about each step, so a task already under way is held between steps too', async () => {
		let paused = false;
		const queue = setup([task('a')], [stepOf(40, 100), stepOf(100, 100, true)], [], { hold: (ctx) => (paused ? ctx.now + 900_000 : null) });
		await queue.tick(NOW);
		expect(queue.task('a')).toMatchObject({ steps: 1, progress: progress(40, 100), creditsUsed: 7 });

		paused = true;
		const held = await queue.tick(NOW + 1_000);
		expect(held.nextAlarmAt).toBe(NOW + 1_000 + 900_000);
		expect(queue.task('a')).toMatchObject({ status: 'queued', steps: 1, progress: progress(40, 100), creditsUsed: 7 });
		expect(queue.charges).toHaveLength(1);

		paused = false;
		await queue.tick(NOW + 1_000 + 900_000);
		expect(queue.task('a')).toMatchObject({ status: 'done', steps: 2, creditsUsed: 14 });
		expect(queue.charges.map((charge) => charge.step)).toEqual([0, 1]);
	});

	it('counts a kind whose hold throws as a failed step, with its own message', async () => {
		const queue = setup([task('a')], [stepOf(40, 100)], [], {
			hold: () => {
				throw new Error('The flag service gave nonsense');
			},
			describeError: () => 'Something with the flag went wrong.',
		});
		await queue.tick(NOW);
		expect(queue.stepped).toEqual([]);
		expect(queue.task('a')).toMatchObject({ status: 'queued', attempts: 1, lastError: 'Something with the flag went wrong.', runAt: NOW + TASK_RETRY_DELAYS_MS[0] });
	});

	it('finishes a task whose step says finished and calls onFinished once', async () => {
		const queue = setup([task('a')], [stepOf(100, 100, true)]);

		expect(await queue.tick(NOW)).toEqual({ nextAlarmAt: null });
		expect(queue.task('a')).toMatchObject({ status: 'done', finishedAt: NOW, progress: progress(100, 100), steps: 1 });
		expect(queue.finished).toEqual(['a']);

		await queue.tick(NOW + 1_000);
		expect(queue.finished).toEqual(['a']);
		expect(queue.stepped).toHaveLength(1);
	});

	it('gives onFinished the finishing step, whose progress and flags are newer than the task it was claimed with', async () => {
		const finishing: TaskStepResult = { ...stepOf(100, 100, true), ready: true };
		const queue = setup([task('a', { steps: 2, status: 'running', progress: progress(40, 100) })], [finishing]);

		await queue.tick(NOW);

		expect(queue.finishedWith).toEqual([finishing]);
		expect(queue.task('a').status).toBe('done');
	});

	it('a step that says failed ends the task failed with that message, after saving and charging the step, and never calls onFinished', async () => {
		const message = "Couldn't translate most of your store's text.";
		const failing: TaskStepResult = { ...stepOf(30, 100, true), progress: progress(30, 100, 70), failed: message };
		const queue = setup([task('a', { steps: 2, status: 'running', startedAt: NOW - 1_000 })], [failing]);

		expect(await queue.tick(NOW)).toEqual({ nextAlarmAt: null });

		expect(queue.task('a')).toMatchObject({ status: 'failed', lastError: message, finishedAt: NOW, progress: progress(30, 100, 70), steps: 3, creditsUsed: 7 });
		expect(queue.charges).toEqual([{ userId: 'seller_1', taskId: 'a', step: 2, calls: [CALL] }]);
		expect(queue.finished).toEqual([]);
		// Told once, like any other ending, with the task as it was stored.
		expect(queue.ended).toMatchObject([{ id: 'a', status: 'failed', lastError: message }]);
		expect(queue.stepped).toHaveLength(1);
	});

	it('a failing step of a task the seller canceled meanwhile leaves the cancel standing', async () => {
		const failing: TaskStepResult = { ...stepOf(30, 100, true), failed: "Couldn't translate most of your store's text." };
		let queue: ReturnType<typeof setup> | undefined;
		queue = setup([task('a', { steps: 2, status: 'running' })], [
			(ctx) => {
				queue?.cancel(ctx.task.id, NOW);
				return failing;
			},
		]);

		await queue.tick(NOW);

		expect(queue.task('a')).toMatchObject({ status: 'canceled', steps: 3 });
		expect(queue.ended).toEqual([]);
		expect(queue.finished).toEqual([]);
	});

	it("charges the meter with the step's calls under task:<id>:<step>", async () => {
		const second: ModelCall = { model: 'google-ai-studio/gemini-3.6-flash', usage: null };
		const queue = setup([task('a', { steps: 2, creditsUsed: 30, status: 'running', startedAt: NOW - 60_000 })], [stepOf(80, 120, false, [CALL, second]), stepOf(120, 120, true, [])]);

		await queue.tick(NOW);
		await queue.tick(NOW + 1_000);

		expect(queue.charges).toEqual([
			{ userId: 'seller_1', taskId: 'a', step: 2, calls: [CALL, second] },
			{ userId: 'seller_1', taskId: 'a', step: 3, calls: [] },
		]);
		expect(queue.task('a')).toMatchObject({ status: 'done', steps: 4, creditsUsed: 30 + 14 });
	});

	it('retries a throwing step after each of the five backoffs, and fails it at the 6th failure in a row', async () => {
		expect(TASK_MAX_FAILURES).toBe(6);
		const queue = setup([task('a')], [new Error('The batch could not be read')]);

		let now = NOW;
		const waits: number[] = [];
		for (let failure = 1; failure < TASK_MAX_FAILURES; failure += 1) {
			const { nextAlarmAt } = await queue.tick(now);
			expect(queue.task('a')).toMatchObject({ status: 'queued', attempts: failure, lastError: TASK_RETRY_MESSAGE });
			expect(nextAlarmAt).toBe(queue.task('a').runAt);
			waits.push((nextAlarmAt ?? 0) - now);
			now = nextAlarmAt ?? now;
		}
		expect(waits).toEqual([30_000, 120_000, 600_000, 1_800_000, 7_200_000]);
		expect(waits).toEqual(TASK_RETRY_DELAYS_MS);

		expect(await queue.tick(now)).toEqual({ nextAlarmAt: null });
		expect(queue.task('a')).toMatchObject({ status: 'failed', attempts: TASK_MAX_FAILURES, lastError: TASK_FAILED_MESSAGE, finishedAt: now });
		expect(queue.stepped).toHaveLength(TASK_MAX_FAILURES);
		expect(queue.charges).toEqual([]);
	});

	it("never stores a step's raw error, which may name a provider: the kind's description or a generic message, and the raw error is logged", async () => {
		const leaky = new Error('google-ai-studio returned 429: quota exceeded for gemini-3.6-flash');

		const plain = setup([task('a')], [leaky]);
		await plain.tick(NOW);
		expect(plain.task('a').lastError).toBe(TASK_RETRY_MESSAGE);
		const logged = errorLog.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
		expect(logged).toContain('quota exceeded for gemini-3.6-flash');
		expect(logged).toContain('"taskId":"a"');

		const described = setup([task('b')], [leaky], [], { describeError: () => 'The translation service is busy. Estori will try again.' });
		await described.tick(NOW);
		expect(described.task('b').lastError).toBe('The translation service is busy. Estori will try again.');

		await runUntilIdle(plain, NOW + 1);
		await runUntilIdle(described, NOW + 1);
		expect(plain.task('a')).toMatchObject({ status: 'failed', lastError: TASK_FAILED_MESSAGE });
		expect(described.task('b')).toMatchObject({ status: 'failed', lastError: 'The translation service is busy. Estori will try again.' });
		expect(JSON.stringify([plain.task('a'), described.task('b')])).not.toMatch(/google|gemini|429/);
	});

	it('pauses with reason credits when the meter gate refuses without resumeAt', async () => {
		const queue = setup([task('a', { status: 'running', steps: 3, progress: progress(120, 400), creditsUsed: 90, startedAt: NOW - 60_000 })], [stepOf(160, 400)], [{ ok: false, reason: 'credits', resumeAt: null }]);

		expect(await queue.tick(NOW)).toEqual({ nextAlarmAt: null });

		expect(queue.task('a')).toMatchObject({ status: 'paused', pauseReason: 'credits' satisfies TaskPauseReason, progress: progress(120, 400), steps: 3, creditsUsed: 90, leaseUntil: null, startedAt: NOW - 60_000 });
		expect(queue.stepped).toEqual([]);
		expect(queue.charges).toEqual([]);
	});

	it('a credit-paused task keeps its progress and resumes at its next step, so a done step is never charged again', async () => {
		const queue = setup([task('a')], [stepOf(40, 120), stepOf(80, 120), stepOf(120, 120, true)], [{ ok: true }, { ok: false, reason: 'credits', resumeAt: null }]);

		await queue.tick(NOW);
		await queue.tick(NOW + 1_000);
		expect(queue.task('a')).toMatchObject({ status: 'paused', progress: progress(40, 120), steps: 1 });

		queue.resume('a', NOW + 60_000);
		await queue.tick(NOW + 60_000);
		await queue.tick(NOW + 61_000);

		expect(queue.charges.map((charge) => charge.step)).toEqual([0, 1, 2]);
		expect(queue.task('a')).toMatchObject({ status: 'done', progress: progress(120, 120), steps: 3, creditsUsed: 21 });
	});

	it('defers to resumeAt with reason daily-limit when the gate refuses with resumeAt', async () => {
		const tomorrow = NOW + 3 * 60 * 60 * 1000;
		const queue = setup([task('a')], [stepOf(40, 40, true)], [{ ok: false, reason: 'daily-limit', resumeAt: tomorrow }]);

		expect(await queue.tick(NOW)).toEqual({ nextAlarmAt: tomorrow });
		// It never ran a step, so it shows no start time.
		expect(queue.task('a')).toMatchObject({ status: 'queued', pauseReason: 'daily-limit', runAt: tomorrow, leaseUntil: null, startedAt: null });
		expect(queue.stepped).toEqual([]);

		// Nothing runs before then.
		expect(await queue.tick(NOW + 60_000)).toEqual({ nextAlarmAt: tomorrow });
		expect(queue.gated()).toBe(1);

		await queue.tick(tomorrow);
		expect(queue.task('a')).toMatchObject({ status: 'done', pauseReason: null, startedAt: tomorrow });
	});

	it('skips canceled tasks and arms the next alarm at the earliest run_at', async () => {
		const queue = setup(
			[
				task('canceled', { status: 'canceled', runAt: NOW - 10_000, finishedAt: NOW - 5_000 }),
				task('done', { status: 'done', runAt: NOW - 10_000, finishedAt: NOW - 5_000 }),
				task('later', { runAt: NOW + 60_000 }),
				task('sooner', { runAt: NOW + 30_000 }),
			],
			[],
		);

		expect(await queue.tick(NOW)).toEqual({ nextAlarmAt: NOW + 30_000 });
		expect(queue.stepped).toEqual([]);
		expect(queue.task('canceled').status).toBe('canceled');
	});

	it('returns nextAlarmAt null when nothing is queued', async () => {
		const empty = setup([], []);
		expect(await empty.tick(NOW)).toEqual({ nextAlarmAt: null });

		const finished = setup([task('a', { status: 'failed' }), task('b', { status: 'paused', pauseReason: 'credits' })], []);
		expect(await finished.tick(NOW)).toEqual({ nextAlarmAt: null });
		expect(finished.gated()).toBe(0);
	});

	it('an unknown kind or unparsable payload fails the task without retrying', async () => {
		const unknown = setup([task('a')], [stepOf(1, 1, true)]);
		const result = await runTaskTick({ store: unknown.store, meter: unknown.meter, kinds: () => null, env: ENV, ended: (record) => void unknown.ended.push(record) }, 'seller_1', NOW);
		expect(result).toEqual({ nextAlarmAt: null });
		expect(unknown.ended.map((record) => record.id)).toEqual(['a']);
		expect(unknown.task('a')).toMatchObject({ status: 'failed', finishedAt: NOW, attempts: 0, lastError: TASK_FAILED_MESSAGE });
		expect(unknown.stepped).toEqual([]);

		const unreadable = setup([task('b', { payload: { appId: 'app_1' } })], [stepOf(1, 1, true)]);
		expect(await unreadable.tick(NOW)).toEqual({ nextAlarmAt: null });
		expect(unreadable.task('b')).toMatchObject({ status: 'failed', attempts: 0, lastError: TASK_FAILED_MESSAGE });
		expect(unreadable.stepped).toEqual([]);
		expect(unreadable.gated()).toBe(0);
	});

	it('a step whose save failed counts as a failure and runs again under the same step number, so it is charged once', async () => {
		const queue = setup([task('a')], [stepOf(40, 80), stepOf(40, 80)]);
		queue.failNext('saveStep', 1);

		expect(await queue.tick(NOW)).toEqual({ nextAlarmAt: NOW + TASK_RETRY_DELAYS_MS[0] });
		expect(queue.task('a')).toMatchObject({ status: 'queued', attempts: 1, steps: 0, lastError: TASK_RETRY_MESSAGE });

		await queue.tick(NOW + TASK_RETRY_DELAYS_MS[0]);
		expect(queue.charges.map((charge) => [charge.taskId, charge.step])).toEqual([
			['a', 0],
			['a', 0],
		]);
		expect(queue.task('a')).toMatchObject({ steps: 1, creditsUsed: 7, progress: progress(40, 80), attempts: 0, lastError: null });
	});

	it('when even the failure cannot be recorded, the tick throws and the lease holds the task until it runs out', async () => {
		const queue = setup([task('a')], [stepOf(40, 80)]);
		queue.failNext('saveStep', 1);
		queue.failNext('recordFailure', 1);

		await expect(queue.tick(NOW)).rejects.toThrow('D1 is unavailable');
		// The runner's alarm retries a minute later; the lease still holds the task.
		expect(await queue.tick(NOW + 60_000)).toEqual({ nextAlarmAt: NOW + TASK_LEASE_MS });
		expect(queue.stepped).toHaveLength(1);

		await queue.tick(NOW + TASK_LEASE_MS);
		expect(queue.charges.map((charge) => charge.step)).toEqual([0, 0]);
		expect(queue.task('a')).toMatchObject({ steps: 1, creditsUsed: 7 });
	});

	it('a meter whose charge always throws ends the task failed instead of paying for model calls forever', async () => {
		const queue = setup([task('a')], [stepOf(40, 80)], [], { chargeFails: true });

		const { ticks } = await runUntilIdle(queue, NOW);

		expect(ticks).toBe(TASK_MAX_FAILURES);
		expect(queue.stepped).toHaveLength(TASK_MAX_FAILURES);
		expect(queue.task('a')).toMatchObject({ status: 'failed', attempts: TASK_MAX_FAILURES, steps: 0, lastError: TASK_FAILED_MESSAGE });
	});

	it('a meter gate that throws counts as a failure too', async () => {
		const queue = setup([task('a')], [stepOf(40, 80)], [], { gateFails: true });

		await runUntilIdle(queue, NOW);

		expect(queue.task('a')).toMatchObject({ status: 'failed', attempts: TASK_MAX_FAILURES });
		expect(queue.stepped).toEqual([]);
	});

	it('an onFinished that throws is retried by running the step again', async () => {
		let failOnce = true;
		const queue = setup([task('a')], [stepOf(10, 10, true), stepOf(10, 10, true, [])], [], {
			onFinished: () => {
				if (failOnce) {
					failOnce = false;
					throw new Error('Could not mark the language ready');
				}
			},
		});

		const first = await queue.tick(NOW);
		expect(queue.task('a')).toMatchObject({ status: 'queued', attempts: 1, lastError: TASK_RETRY_MESSAGE });
		await queue.tick(first.nextAlarmAt ?? NOW);
		expect(queue.task('a')).toMatchObject({ status: 'done', steps: 2, attempts: 0, lastError: null });
		expect(queue.finished).toEqual(['a', 'a']);
	});

	it('an onFinished that keeps throwing fails the task after TASK_MAX_FAILURES', async () => {
		const queue = setup([task('a')], [stepOf(10, 10, true, [])], [], {
			onFinished: () => {
				throw new Error('Could not mark the language ready');
			},
		});

		const { ticks } = await runUntilIdle(queue, NOW);

		expect(ticks).toBe(TASK_MAX_FAILURES);
		expect(queue.finished).toHaveLength(TASK_MAX_FAILURES);
		expect(queue.task('a')).toMatchObject({ status: 'failed', attempts: TASK_MAX_FAILURES, lastError: TASK_FAILED_MESSAGE });
	});

	it('a step that cancels its own task never calls onFinished', async () => {
		const queue = setup([task('a')], [
			(ctx) => {
				queue.cancel(ctx.task.id, NOW);
				return stepOf(10, 10, true);
			},
		]);

		expect(await queue.tick(NOW)).toEqual({ nextAlarmAt: null });

		expect(queue.finished).toEqual([]);
		expect(queue.task('a')).toMatchObject({ status: 'canceled', finishedAt: NOW, progress: progress(10, 10), steps: 1, creditsUsed: 7 });
	});
});

describe('task spend events', () => {
	const summary = (record: TaskRecord) => ({ id: record.id, status: record.status, creditsUsed: record.creditsUsed, steps: record.steps });

	it('reports a finished task once, with its steps and credits including the last step', async () => {
		const queue = setup([task('a')], [stepOf(40, 80), stepOf(80, 80, true)]);

		await queue.tick(NOW);
		expect(queue.ended).toEqual([]);
		await queue.tick(NOW + 1_000);
		await queue.tick(NOW + 2_000);

		expect(queue.ended.map(summary)).toEqual([{ id: 'a', status: 'done', creditsUsed: 14, steps: 2 }]);
	});

	it('reports a task that fails for good once, and a failure that will be retried not at all', async () => {
		const queue = setup([task('a')], [stepOf(40, 80), new Error('The batch could not be read')]);

		await queue.tick(NOW);
		let now = NOW + 1_000;
		for (let failure = 1; failure < TASK_MAX_FAILURES; failure += 1) {
			const { nextAlarmAt } = await queue.tick(now);
			expect(queue.ended, `after failure ${failure}`).toEqual([]);
			now = nextAlarmAt ?? now;
		}
		await queue.tick(now);

		expect(queue.ended.map(summary)).toEqual([{ id: 'a', status: 'failed', creditsUsed: 7, steps: 1 }]);
		await queue.tick(now + 1_000);
		expect(queue.ended).toHaveLength(1);
	});

	it('reports a task whose kind or payload is unusable once, as failed', async () => {
		const queue = setup([task('a', { payload: 'unreadable' })], [stepOf(1, 1, true)]);

		await queue.tick(NOW);
		await queue.tick(NOW + 1_000);

		expect(queue.ended.map(summary)).toEqual([{ id: 'a', status: 'failed', creditsUsed: 0, steps: 0 }]);
	});

	it("leaves a canceled task to the seller's cancel: a step finishing or failing after it reports nothing", async () => {
		const seller: { cancel?: (id: string, now: number) => void } = {};
		const finishing = setup([task('a')], [(ctx) => {
			seller.cancel?.(ctx.task.id, NOW + 1);
			return stepOf(80, 80, true);
		}]);
		seller.cancel = finishing.cancel;
		await finishing.tick(NOW);
		expect(finishing.ended).toEqual([]);
		expect(finishing.task('a')).toMatchObject({ status: 'canceled', steps: 1, creditsUsed: 7 });

		const failing = setup([task('b')], [(ctx) => {
			seller.cancel?.(ctx.task.id, NOW + 1);
			throw new Error('The batch could not be read');
		}]);
		seller.cancel = failing.cancel;
		await failing.tick(NOW);
		expect(failing.ended).toEqual([]);
		expect(failing.task('b')).toMatchObject({ status: 'canceled' });
	});

	it('reports nothing for a task the credits or the daily limit hold back', async () => {
		const queue = setup([task('a'), task('b', { runAt: NOW + 1 })], [stepOf(1, 1, true)], [{ ok: false, reason: 'credits', resumeAt: null }, { ok: false, reason: 'daily-limit', resumeAt: NOW + 60_000 }]);

		await queue.tick(NOW);
		await queue.tick(NOW + 1);

		expect(queue.ended).toEqual([]);
	});
});
