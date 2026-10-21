/**
 * The seller task queue on real SQL: dedupe and the per-seller limit, claiming with a lease, saving steps, failures,
 * pausing, and the seller's cancel and resume. Each test's writes are rolled back after it.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { MAX_UNFINISHED_TASKS, TASK_LEASE_MS, TASK_MAX_FAILURES, TASK_RETRY_DELAYS_MS } from '../../../shared/types/tasks';
import { envWith, insertApp, insertUser, migratedD1 } from '../test-support/real-d1';
import { TaskService, type TaskRecord } from './TaskService';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
const KEY = 'store.translate:app_1:es';
let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	for (const id of ['seller_1', 'seller_2', 'seller_3', 'seller_4', 'seller_5']) await insertUser(db, id);
	await insertApp(db, { id: 'app_1', userId: 'seller_1' });
	await insertApp(db, { id: 'app_2', userId: 'seller_1' });
	await insertApp(db, { id: 'app_other', userId: 'seller_2' });
});

const service = () => new TaskService(envWith(db));

function enqueue(userId: string, dedupeKey: string, options: { runAt?: number; now?: number; appId?: string | null } = {}) {
	const appId = options.appId === undefined ? (userId === 'seller_1' ? 'app_1' : null) : options.appId;
	return service().enqueue({ userId, appId, kind: 'store.translate', payload: { appId, locale: 'es' }, dedupeKey, runAt: options.runAt, now: options.now ?? NOW });
}

async function queued(userId: string, dedupeKey: string, options: { runAt?: number; now?: number; appId?: string | null } = {}): Promise<TaskRecord> {
	const result = await enqueue(userId, dedupeKey, options);
	if (!('task' in result)) throw new Error(`Refused: ${result.refused}`);
	return result.task;
}

async function read(id: string): Promise<TaskRecord> {
	for (const userId of ['seller_1', 'seller_2', 'seller_3', 'seller_4', 'seller_5']) {
		const found = (await service().listForUser(userId, { limit: 100 })).find((task) => task.id === id);
		if (found) return found;
	}
	throw new Error(`No task ${id}`);
}

const progress = (done: number, total: number, skipped = 0) => ({ done, total, skipped });

describe('the task queue on real SQL', () => {
	it('enqueue with the same dedupeKey while unfinished returns created false', async () => {
		const first = await enqueue('seller_1', KEY, { runAt: NOW - 1_000 });
		expect(first).toMatchObject({
			created: true,
			task: { userId: 'seller_1', appId: 'app_1', kind: 'store.translate', status: 'queued', payload: { appId: 'app_1', locale: 'es' }, progress: progress(0, 0), creditsUsed: 0, attempts: 0, steps: 0, runAt: NOW - 1_000, dedupeKey: KEY, createdAt: NOW, startedAt: null },
		});
		if (!('task' in first)) throw new Error('Refused');
		expect(await enqueue('seller_1', KEY)).toEqual({ created: false, task: first.task });

		// Two quick clicks at once queue one task.
		const clicks = await Promise.all([enqueue('seller_1', 'store.translate:app_1:pt-BR'), enqueue('seller_1', 'store.translate:app_1:pt-BR')]);
		expect(clicks.map((click) => ('created' in click ? click.created : null)).sort()).toEqual([false, true]);
		expect(new Set(clicks.map((click) => ('task' in click ? click.task.id : null))).size).toBe(1);

		// A publish while the task runs, or while it's paused, queues nothing.
		expect(await service().claimNext('seller_1', NOW, TASK_LEASE_MS)).toMatchObject({ id: first.task.id });
		expect(await enqueue('seller_1', KEY)).toMatchObject({ created: false, task: { id: first.task.id, status: 'running' } });
		await service().pause(first.task.id, 'credits');
		expect(await enqueue('seller_1', KEY)).toMatchObject({ created: false, task: { id: first.task.id, status: 'paused' } });

		// Once it's finished, the same work can be queued again.
		await service().cancel(first.task.id, 'seller_1', NOW);
		const again = await enqueue('seller_1', KEY);
		expect(again).toMatchObject({ created: true, task: { status: 'queued' } });
		expect('task' in again && again.task.id).not.toBe(first.task.id);

		// Keys are each seller's own.
		expect(await enqueue('seller_2', KEY, { appId: 'app_other' })).toMatchObject({ created: true, task: { userId: 'seller_2' } });
	});

	it('refuses past MAX_UNFINISHED_TASKS', async () => {
		for (let index = 0; index < MAX_UNFINISHED_TASKS; index += 1) await queued('seller_2', `work:${index}`);
		expect(await enqueue('seller_2', 'work:one-more')).toEqual({ refused: 'limit' });
		// The same work again is still the task it already has.
		expect(await enqueue('seller_2', 'work:7')).toMatchObject({ created: false, task: { dedupeKey: 'work:7' } });
		// Another seller has their own room.
		expect(await enqueue('seller_3', 'work:one-more')).toMatchObject({ created: true });

		// Finished tasks don't count.
		const [newest] = await service().listForUser('seller_2', { limit: 1 });
		await service().cancel(newest.id, 'seller_2', NOW);
		expect(await enqueue('seller_2', 'work:one-more')).toMatchObject({ created: true });
		expect(await enqueue('seller_2', 'work:two-more')).toEqual({ refused: 'limit' });
	});

	it('claimNext takes the earliest due task, honours the lease, and reclaims an expired lease', async () => {
		await queued('seller_1', 'later', { runAt: NOW + HOUR });
		const first = await queued('seller_1', 'first', { runAt: NOW - 5_000 });
		const second = await queued('seller_1', 'second', { runAt: NOW - 1_000 });
		await queued('seller_2', 'other', { runAt: NOW - 60_000 });

		expect(await service().claimNext('seller_1', NOW, TASK_LEASE_MS)).toMatchObject({ id: first.id, status: 'running', leaseUntil: NOW + TASK_LEASE_MS, startedAt: NOW });
		// One step at a time per seller: nothing else is taken while the lease holds.
		expect(await service().claimNext('seller_1', NOW + 1_000, TASK_LEASE_MS)).toBeNull();
		expect(await service().nextRunAt('seller_1')).toBe(NOW + TASK_LEASE_MS);

		// A lost step's lease runs out, and the task is taken again where it was.
		const retaken = NOW + TASK_LEASE_MS;
		expect(await service().claimNext('seller_1', retaken, TASK_LEASE_MS)).toMatchObject({ id: first.id, leaseUntil: retaken + TASK_LEASE_MS, startedAt: NOW });

		// A saved step releases the lease, and the task goes behind the seller's other due work.
		await service().saveStep(first.id, { progress: progress(40, 100), credits: 12, steps: 1, finished: false }, retaken + 1);
		expect(await read(first.id)).toMatchObject({ status: 'running', leaseUntil: null, runAt: retaken + 1, progress: progress(40, 100), creditsUsed: 12, steps: 1 });
		expect(await service().claimNext('seller_1', retaken + 2, TASK_LEASE_MS)).toMatchObject({ id: second.id });
		await service().saveStep(second.id, { progress: progress(5, 10), credits: 3, steps: 1, finished: false }, retaken + 3);
		expect(await service().claimNext('seller_1', retaken + 4, TASK_LEASE_MS)).toMatchObject({ id: first.id, progress: progress(40, 100), creditsUsed: 12, steps: 1 });

		// Work that isn't due yet waits.
		await service().finish(first.id, retaken + 5);
		await service().claimNext('seller_1', retaken + 6, TASK_LEASE_MS);
		await service().finish(second.id, retaken + 7);
		expect(await service().claimNext('seller_1', retaken + 8, TASK_LEASE_MS)).toBeNull();
		expect(await service().nextRunAt('seller_1')).toBe(NOW + HOUR);
	});

	it("cancel and resume only touch the caller's own tasks", async () => {
		const mine = await queued('seller_1', 'mine');
		expect(await service().cancel(mine.id, 'seller_2', NOW)).toBeNull();
		expect(await read(mine.id)).toMatchObject({ status: 'queued' });
		expect(await service().cancel(mine.id, 'seller_1', NOW + 1)).toMatchObject({ id: mine.id, status: 'canceled', finishedAt: NOW + 1 });
		// A finished task can't be canceled again or resumed.
		expect(await service().cancel(mine.id, 'seller_1', NOW + 2)).toBeNull();
		expect(await service().resume(mine.id, 'seller_1', NOW + 2)).toBeNull();

		const paused = await queued('seller_1', 'paused');
		await service().claimNext('seller_1', NOW, TASK_LEASE_MS);
		await service().pause(paused.id, 'credits');
		expect(await service().resume(paused.id, 'seller_2', NOW + 3)).toBeNull();
		expect(await read(paused.id)).toMatchObject({ status: 'paused', pauseReason: 'credits' });
		expect(await service().resume(paused.id, 'seller_1', NOW + 3)).toMatchObject({ id: paused.id, status: 'queued', pauseReason: null, runAt: NOW + 3, leaseUntil: null });

		// A failed task resumes, unless the same work was queued again since.
		await service().claimNext('seller_1', NOW + 4, TASK_LEASE_MS);
		await service().fail(paused.id, 'The store could not be read', NOW + 5);
		expect(await read(paused.id)).toMatchObject({ status: 'failed', lastError: 'The store could not be read', finishedAt: NOW + 5 });
		expect(await service().resume(paused.id, 'seller_1', NOW + 6)).toMatchObject({ status: 'queued', attempts: 0, lastError: null, finishedAt: null });
		await service().claimNext('seller_1', NOW + 6, TASK_LEASE_MS);
		await service().fail(paused.id, 'The store could not be read', NOW + 7);
		const requeued = await queued('seller_1', 'paused');
		expect(requeued.id).not.toBe(paused.id);
		expect(await service().resume(paused.id, 'seller_1', NOW + 8)).toBeNull();
		expect(await read(paused.id)).toMatchObject({ status: 'failed' });
	});

	it('dueUserIds lists sellers with due work and no live lease', async () => {
		await queued('seller_1', 'due', { runAt: NOW - 1_000 });
		await queued('seller_2', 'held', { runAt: NOW - 2_000 });
		await queued('seller_2', 'waiting', { runAt: NOW - 1_000 });
		await service().claimNext('seller_2', NOW, TASK_LEASE_MS);
		await queued('seller_3', 'future', { runAt: NOW + 60_000 });
		const paused = await queued('seller_4', 'paused', { runAt: NOW - 1_000 });
		await service().claimNext('seller_4', NOW, TASK_LEASE_MS);
		await service().pause(paused.id, 'credits');
		const done = await queued('seller_5', 'done', { runAt: NOW - 1_000 });
		await service().claimNext('seller_5', NOW, TASK_LEASE_MS);
		await service().finish(done.id, NOW);

		expect(await service().dueUserIds(NOW, 10)).toEqual(['seller_1']);
		expect((await service().dueUserIds(NOW + 60_000, 10)).sort()).toEqual(['seller_1', 'seller_3']);
		expect((await service().dueUserIds(NOW + TASK_LEASE_MS, 10)).sort()).toEqual(['seller_1', 'seller_2', 'seller_3']);
		expect(await service().dueUserIds(NOW + TASK_LEASE_MS, 1)).toHaveLength(1);
		expect(await service().pausedUserIds('credits', 10)).toEqual(['seller_4']);
		expect(await service().pausedUserIds('seller', 10)).toEqual([]);

		const alsoPaused = await queued('seller_3', 'paused-too', { runAt: NOW - 1_000 });
		await service().claimNext('seller_3', NOW, TASK_LEASE_MS);
		await service().pause(alsoPaused.id, 'credits');
		expect((await service().pausedUserIds('credits', 10)).sort()).toEqual(['seller_3', 'seller_4']);
		expect(await service().pausedUserIds('credits', 1)).toHaveLength(1);
	});

	it('recordFailure retries with each backoff, fails at the last failure with its message kept, and a saved step clears the count', async () => {
		const messages = (text: string) => ({ retry: `${text}, retrying`, failed: `${text}, stopped` });
		const flaky = await queued('seller_1', 'flaky');
		await service().claimNext('seller_1', NOW, TASK_LEASE_MS);
		expect(await service().recordFailure(flaky.id, messages('Timed out'), NOW)).toMatchObject({ id: flaky.id, status: 'queued', attempts: 1 });
		expect(await read(flaky.id)).toMatchObject({ status: 'queued', attempts: 1, lastError: 'Timed out, retrying', runAt: NOW + TASK_RETRY_DELAYS_MS[0], leaseUntil: null });

		let now = NOW + TASK_RETRY_DELAYS_MS[0];
		await service().claimNext('seller_1', now, TASK_LEASE_MS);
		expect(await service().saveStep(flaky.id, { progress: progress(40, 80), credits: 5, steps: 1, finished: false }, now)).toBe('running');
		expect(await read(flaky.id)).toMatchObject({ status: 'running', attempts: 0, lastError: null });

		for (let failure = 1; failure < TASK_MAX_FAILURES; failure += 1) {
			await service().claimNext('seller_1', now, TASK_LEASE_MS);
			expect(await service().recordFailure(flaky.id, messages(`Failure ${failure}`), now)).toMatchObject({ status: 'queued', attempts: failure });
			const task = await read(flaky.id);
			expect(task).toMatchObject({ attempts: failure, runAt: now + TASK_RETRY_DELAYS_MS[failure - 1], lastError: `Failure ${failure}, retrying` });
			now = task.runAt;
		}
		await service().claimNext('seller_1', now, TASK_LEASE_MS);
		expect(await service().recordFailure(flaky.id, messages('Last failure'), now)).toMatchObject({ status: 'failed', attempts: TASK_MAX_FAILURES, lastError: 'Last failure, stopped' });
		expect(await read(flaky.id)).toMatchObject({ status: 'failed', attempts: TASK_MAX_FAILURES, lastError: 'Last failure, stopped', finishedAt: now, progress: progress(40, 80), steps: 1 });

		// A task that isn't running is left alone, and nothing is answered for it.
		expect(await service().recordFailure(flaky.id, messages('Late'), now + 1)).toBeNull();
		expect(await read(flaky.id)).toMatchObject({ lastError: 'Last failure, stopped', attempts: TASK_MAX_FAILURES });
	});

	it('finish and fail answer the task they ended, and null for one that is no longer running', async () => {
		const done = await queued('seller_1', 'ends-done');
		await service().claimNext('seller_1', NOW, TASK_LEASE_MS);
		expect(await service().finish(done.id, NOW + 1)).toMatchObject({ id: done.id, status: 'done', finishedAt: NOW + 1 });
		expect(await service().finish(done.id, NOW + 2)).toBeNull();
		expect(await service().fail(done.id, 'Too late', NOW + 2)).toBeNull();

		const broken = await queued('seller_1', 'ends-failed');
		await service().claimNext('seller_1', NOW, TASK_LEASE_MS);
		expect(await service().fail(broken.id, 'Could not be read', NOW + 3)).toMatchObject({ id: broken.id, status: 'failed', lastError: 'Could not be read' });

		// A seller's cancel during a step stands: the runner's later write changes nothing and answers nothing.
		const canceled = await queued('seller_1', 'ends-canceled');
		await service().claimNext('seller_1', NOW, TASK_LEASE_MS);
		await service().cancel(canceled.id, 'seller_1', NOW + 4);
		expect(await service().finish(canceled.id, NOW + 5)).toBeNull();
		expect(await service().recordFailure(canceled.id, { retry: 'Retrying', failed: 'Stopped' }, NOW + 5)).toBeNull();
		expect(await read(canceled.id)).toMatchObject({ status: 'canceled', finishedAt: NOW + 4 });
	});

	it('the save of a finished step keeps the failure count, so a finish that keeps failing still fails; finish clears it', async () => {
		const task = await queued('seller_1', 'finishing');
		await service().claimNext('seller_1', NOW, TASK_LEASE_MS);
		await service().recordFailure(task.id, { retry: 'Retrying', failed: 'Stopped' }, NOW);

		await service().claimNext('seller_1', NOW + HOUR, TASK_LEASE_MS);
		expect(await service().saveStep(task.id, { progress: progress(10, 10), credits: 2, steps: 1, finished: true }, NOW + HOUR)).toBe('running');
		expect(await read(task.id)).toMatchObject({ status: 'running', attempts: 1, lastError: 'Retrying', steps: 1, creditsUsed: 2 });

		await service().finish(task.id, NOW + HOUR + 1);
		expect(await read(task.id)).toMatchObject({ status: 'done', attempts: 0, lastError: null, finishedAt: NOW + HOUR + 1 });
	});

	it('pause and defer keep the progress, and the task continues at its next step', async () => {
		const task = await queued('seller_1', 'long');
		await service().claimNext('seller_1', NOW, TASK_LEASE_MS);
		await service().saveStep(task.id, { progress: progress(40, 120), credits: 9, steps: 1, finished: false }, NOW);

		await service().claimNext('seller_1', NOW + 1, TASK_LEASE_MS);
		await service().defer(task.id, NOW + 3 * HOUR, 'daily-limit');
		expect(await read(task.id)).toMatchObject({ status: 'queued', pauseReason: 'daily-limit', runAt: NOW + 3 * HOUR, leaseUntil: null, progress: progress(40, 120), steps: 1 });
		expect(await service().claimNext('seller_1', NOW + HOUR, TASK_LEASE_MS)).toBeNull();
		expect(await service().nextRunAt('seller_1')).toBe(NOW + 3 * HOUR);
		expect(await service().claimNext('seller_1', NOW + 3 * HOUR, TASK_LEASE_MS)).toMatchObject({ id: task.id, pauseReason: null, steps: 1, creditsUsed: 9 });

		await service().pause(task.id, 'credits');
		expect(await read(task.id)).toMatchObject({ status: 'paused', startedAt: NOW });
		expect(await service().claimNext('seller_1', NOW + 4 * HOUR, TASK_LEASE_MS)).toBeNull();
		expect(await service().nextRunAt('seller_1')).toBeNull();
		await service().resume(task.id, 'seller_1', NOW + 5 * HOUR);
		expect(await service().claimNext('seller_1', NOW + 5 * HOUR, TASK_LEASE_MS)).toMatchObject({ id: task.id, progress: progress(40, 120), steps: 1, creditsUsed: 9, startedAt: NOW });
	});

	it('pause and defer of a task that never ran a step leave it with no start time', async () => {
		const paused = await queued('seller_1', 'never-ran', { runAt: NOW - 2 });
		const deferred = await queued('seller_1', 'never-ran-either', { runAt: NOW - 1 });
		await service().claimNext('seller_1', NOW, TASK_LEASE_MS);
		await service().pause(paused.id, 'credits');
		await service().claimNext('seller_1', NOW, TASK_LEASE_MS);
		await service().defer(deferred.id, NOW + HOUR, 'daily-limit');

		expect(await read(paused.id)).toMatchObject({ status: 'paused', startedAt: null });
		expect(await read(deferred.id)).toMatchObject({ status: 'queued', startedAt: null });
	});

	it('a step saved after the seller canceled keeps the cancel and says so, and the same step saved twice counts once', async () => {
		const task = await queued('seller_1', 'canceled-mid-step');
		await service().claimNext('seller_1', NOW, TASK_LEASE_MS);
		await service().cancel(task.id, 'seller_1', NOW + 1);

		expect(await service().saveStep(task.id, { progress: progress(40, 100), credits: 9, steps: 1, finished: true }, NOW + 2)).toBe('canceled');
		expect(await service().saveStep(task.id, { progress: progress(40, 100), credits: 9, steps: 1, finished: true }, NOW + 3)).toBeNull();
		await service().finish(task.id, NOW + 4);
		await service().fail(task.id, 'Too late', NOW + 4);

		expect(await read(task.id)).toMatchObject({ status: 'canceled', finishedAt: NOW + 1, progress: progress(40, 100), creditsUsed: 9, steps: 1, lastError: null });
	});

	it('resume keeps a seller within MAX_UNFINISHED_TASKS, though a paused task, already counted, always resumes', async () => {
		const failed = await queued('seller_2', 'failed', { runAt: NOW - 2 });
		const paused = await queued('seller_2', 'paused', { runAt: NOW - 1 });
		await service().claimNext('seller_2', NOW, TASK_LEASE_MS);
		await service().fail(failed.id, 'Stopped', NOW);
		await service().claimNext('seller_2', NOW, TASK_LEASE_MS);
		await service().pause(paused.id, 'credits');
		for (let index = 1; index < MAX_UNFINISHED_TASKS; index += 1) await queued('seller_2', `work:${index}`, { runAt: NOW + HOUR, now: NOW + 10 });

		expect(await service().resume(failed.id, 'seller_2', NOW + 1)).toBeNull();
		expect(await read(failed.id)).toMatchObject({ status: 'failed' });
		expect(await service().resume(paused.id, 'seller_2', NOW + 1)).toMatchObject({ status: 'queued' });

		const [newest] = await service().listForUser('seller_2', { limit: 1 });
		await service().cancel(newest.id, 'seller_2', NOW + 2);
		expect(await service().resume(failed.id, 'seller_2', NOW + 3)).toMatchObject({ status: 'queued' });
	});

	it("lists a seller's tasks newest first, for one store or all", async () => {
		const older = await queued('seller_1', 'older', { now: NOW });
		const otherStore = await queued('seller_1', 'other-store', { now: NOW + 1, appId: 'app_2' });
		const newest = await queued('seller_1', 'newest', { now: NOW + 2 });
		await queued('seller_2', 'someone-else', { appId: 'app_other' });

		expect((await service().listForUser('seller_1', { limit: 10 })).map((task) => task.id)).toEqual([newest.id, otherStore.id, older.id]);
		expect((await service().listForUser('seller_1', { appId: 'app_1', limit: 10 })).map((task) => task.id)).toEqual([newest.id, older.id]);
		expect((await service().listForUser('seller_1', { limit: 1 })).map((task) => task.id)).toEqual([newest.id]);
	});
});
