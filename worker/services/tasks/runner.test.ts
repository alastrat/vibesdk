import { describe, expect, it } from 'vitest';
import { TASK_LEASE_MS, TASK_MAX_FAILURES, TASK_RETRY_DELAYS_MS, taskRetryAt, type TaskPauseReason } from '../../../shared/types/tasks';
import type { TaskRecord } from '../../database/services/TaskService';
import type { ModelCall, TaskKindHandler, TaskStepContext, TaskStepResult } from './kinds';
import type { MeterGate, TaskMeter } from './meter';
import { runTaskTick, type TaskStore } from './runner';

const NOW = 1_800_000_000_000;
const ENV = {} as Env;
const CALL: ModelCall = { model: 'google-ai-studio/gemini-3.6-flash', usage: { inputTokens: 1200, outputTokens: 900 } };

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
	let failSaves = 0;

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
			if (failSaves > 0) {
				failSaves -= 1;
				throw new Error('D1 is unavailable');
			}
			const record = get(id);
			if (record.steps !== step.steps - 1) return;
			Object.assign(record, { progress: step.progress, creditsUsed: record.creditsUsed + step.credits, steps: step.steps, attempts: 0, lastError: null, leaseUntil: null, runAt: now });
		},
		async finish(id, now) {
			const record = get(id);
			if (record.status === 'running') Object.assign(record, { status: 'done', finishedAt: now, leaseUntil: null, pauseReason: null });
		},
		async fail(id, message, now) {
			const record = get(id);
			if (record.status === 'running') Object.assign(record, { status: 'failed', lastError: message, finishedAt: now, leaseUntil: null });
		},
		async recordFailure(id, message, now) {
			const record = get(id);
			if (record.status !== 'running') return 'failed';
			const failures = record.attempts + 1;
			const retryAt = taskRetryAt(failures, now);
			if (retryAt === null) {
				Object.assign(record, { status: 'failed', attempts: failures, lastError: message, finishedAt: now, leaseUntil: null });
				return 'failed';
			}
			Object.assign(record, { status: 'queued', attempts: failures, lastError: message, runAt: retryAt, leaseUntil: null });
			return 'retry';
		},
		async pause(id, reason) {
			const record = get(id);
			if (claimable(record)) Object.assign(record, { status: 'paused', pauseReason: reason, leaseUntil: null });
		},
		async defer(id, runAt, reason) {
			const record = get(id);
			if (claimable(record)) Object.assign(record, { status: 'queued', runAt, pauseReason: reason, leaseUntil: null });
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
		failNextSaves(count: number) {
			failSaves = count;
		},
	};
}

type Payload = { appId: string; locale: string };
type Scripted = TaskStepResult | Error;

function fakeKind(script: Scripted[], options: { onFinished?: (ctx: TaskStepContext) => void } = {}) {
	const stepped: Array<{ taskId: string; now: number; payload: Payload }> = [];
	const finished: string[] = [];
	const handler: TaskKindHandler<Payload> = {
		kind: 'store.translate',
		parsePayload(raw) {
			if (typeof raw !== 'object' || raw === null) return null;
			const { appId, locale } = raw as Record<string, unknown>;
			return typeof appId === 'string' && typeof locale === 'string' ? { appId, locale } : null;
		},
		async step(ctx, payload) {
			stepped.push({ taskId: ctx.task.id, now: ctx.now, payload });
			const next = script.shift();
			if (!next) throw new Error('No scripted step');
			if (next instanceof Error) throw next;
			return next;
		},
		async onFinished(ctx) {
			finished.push(ctx.task.id);
			options.onFinished?.(ctx);
		},
	};
	return { handler, stepped, finished };
}

function fakeMeter(gates: MeterGate[] = []) {
	const charges: Array<{ userId: string; taskId: string; step: number; calls: ModelCall[] }> = [];
	let gated = 0;
	const meter: TaskMeter = {
		async gate() {
			gated += 1;
			return gates.shift() ?? { ok: true };
		},
		async charge(input) {
			charges.push(input);
			return input.calls.length * 7;
		},
	};
	return { meter, charges, gated: () => gated };
}

function setup(tasks: TaskRecord[], script: Scripted[], gates: MeterGate[] = []) {
	const memory = memoryStore(tasks);
	const kind = fakeKind(script);
	const metering = fakeMeter(gates);
	const deps = { store: memory.store, meter: metering.meter, kinds: (name: string) => (name === kind.handler.kind ? kind.handler : null), env: ENV };
	return { ...memory, ...kind, ...metering, tick: (now: number) => runTaskTick(deps, 'seller_1', now) };
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

	it('finishes a task whose step says finished and calls onFinished once', async () => {
		const queue = setup([task('a')], [stepOf(100, 100, true)]);

		expect(await queue.tick(NOW)).toEqual({ nextAlarmAt: null });
		expect(queue.task('a')).toMatchObject({ status: 'done', finishedAt: NOW, progress: progress(100, 100), steps: 1 });
		expect(queue.finished).toEqual(['a']);

		await queue.tick(NOW + 1_000);
		expect(queue.finished).toEqual(['a']);
		expect(queue.stepped).toHaveLength(1);
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

	it('retries a throwing step with the first backoff, and fails it after 5 failures with the error kept', async () => {
		const queue = setup([task('a')], Array.from({ length: TASK_MAX_FAILURES }, () => new Error('The batch could not be read')));

		let now = NOW;
		const waits: number[] = [];
		for (let failure = 1; failure < TASK_MAX_FAILURES; failure += 1) {
			const { nextAlarmAt } = await queue.tick(now);
			expect(queue.task('a')).toMatchObject({ status: 'queued', attempts: failure, lastError: 'The batch could not be read' });
			expect(nextAlarmAt).toBe(queue.task('a').runAt);
			waits.push((nextAlarmAt ?? 0) - now);
			now = nextAlarmAt ?? now;
		}
		expect(waits[0]).toBe(30_000);
		expect(waits).toEqual(TASK_RETRY_DELAYS_MS.slice(0, TASK_MAX_FAILURES - 1));

		expect(await queue.tick(now)).toEqual({ nextAlarmAt: null });
		expect(queue.task('a')).toMatchObject({ status: 'failed', attempts: TASK_MAX_FAILURES, lastError: 'The batch could not be read', finishedAt: now });
		expect(queue.charges).toEqual([]);
	});

	it('pauses with reason credits when the meter gate refuses without resumeAt', async () => {
		const queue = setup([task('a', { status: 'running', steps: 3, progress: progress(120, 400), creditsUsed: 90, startedAt: NOW - 60_000 })], [stepOf(160, 400)], [{ ok: false, reason: 'credits', resumeAt: null }]);

		expect(await queue.tick(NOW)).toEqual({ nextAlarmAt: null });

		expect(queue.task('a')).toMatchObject({ status: 'paused', pauseReason: 'credits' satisfies TaskPauseReason, progress: progress(120, 400), steps: 3, creditsUsed: 90, leaseUntil: null });
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
		expect(queue.task('a')).toMatchObject({ status: 'queued', pauseReason: 'daily-limit', runAt: tomorrow, leaseUntil: null });
		expect(queue.stepped).toEqual([]);

		// Nothing runs before then.
		expect(await queue.tick(NOW + 60_000)).toEqual({ nextAlarmAt: tomorrow });
		expect(queue.gated()).toBe(1);

		await queue.tick(tomorrow);
		expect(queue.task('a')).toMatchObject({ status: 'done', pauseReason: null });
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
		const result = await runTaskTick({ store: unknown.store, meter: unknown.meter, kinds: () => null, env: ENV }, 'seller_1', NOW);
		expect(result).toEqual({ nextAlarmAt: null });
		expect(unknown.task('a')).toMatchObject({ status: 'failed', finishedAt: NOW, attempts: 0 });
		expect(unknown.task('a').lastError).toEqual(expect.any(String));
		expect(unknown.stepped).toEqual([]);

		const unreadable = setup([task('b', { payload: { appId: 'app_1' } })], [stepOf(1, 1, true)]);
		expect(await unreadable.tick(NOW)).toEqual({ nextAlarmAt: null });
		expect(unreadable.task('b')).toMatchObject({ status: 'failed', attempts: 0 });
		expect(unreadable.stepped).toEqual([]);
		expect(unreadable.gated()).toBe(0);
	});

	it('runs a step whose save was lost again under the same step number, after the lease, so it is charged once', async () => {
		const queue = setup([task('a')], [stepOf(40, 80), stepOf(40, 80)]);
		queue.failNextSaves(1);

		await expect(queue.tick(NOW)).rejects.toThrow('D1 is unavailable');
		// The runner's alarm retries a minute later; the lease still holds the task.
		expect(await queue.tick(NOW + 60_000)).toEqual({ nextAlarmAt: NOW + TASK_LEASE_MS });
		expect(queue.stepped).toHaveLength(1);

		await queue.tick(NOW + TASK_LEASE_MS);
		expect(queue.charges.map((charge) => [charge.taskId, charge.step])).toEqual([
			['a', 0],
			['a', 0],
		]);
		expect(queue.task('a')).toMatchObject({ steps: 1, creditsUsed: 7, progress: progress(40, 80) });
	});

	it('an onFinished that throws is retried by running the step again', async () => {
		let failOnce = true;
		const memory = memoryStore([task('a')]);
		const kind = fakeKind([stepOf(10, 10, true), stepOf(10, 10, true, [])], {
			onFinished: () => {
				if (failOnce) {
					failOnce = false;
					throw new Error('Could not mark the language ready');
				}
			},
		});
		const metering = fakeMeter();
		const deps = { store: memory.store, meter: metering.meter, kinds: () => kind.handler, env: ENV };

		const first = await runTaskTick(deps, 'seller_1', NOW);
		expect(memory.task('a')).toMatchObject({ status: 'queued', attempts: 1, lastError: 'Could not mark the language ready' });
		await runTaskTick(deps, 'seller_1', first.nextAlarmAt ?? NOW);
		expect(memory.task('a')).toMatchObject({ status: 'done', steps: 2 });
		expect(kind.finished).toEqual(['a', 'a']);
	});
});
