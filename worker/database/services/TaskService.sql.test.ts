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
		await service().saveStep(first.id, { progress: progress(40, 100), credits: 12, steps: 1 }, retaken + 1);
		expect(await read(first.id)).toMatchObject({ status: 'running', leaseUntil: null, runAt: retaken + 1, progress: progress(40, 100), creditsUsed: 12, steps: 1 });
		expect(await service().claimNext('seller_1', retaken + 2, TASK_LEASE_MS)).toMatchObject({ id: second.id });
		await service().saveStep(second.id, { progress: progress(5, 10), credits: 3, steps: 1 }, retaken + 3);
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
		expect(await service().pausedUserIds('credits')).toEqual(['seller_4']);
		expect(await service().pausedUserIds('seller')).toEqual([]);
	});

	it('recordFailure retries with backoff, fails at the last failure with the error kept, and a saved step clears the count', async () => {
		const flaky = await queued('seller_1', 'flaky');
		await service().claimNext('seller_1', NOW, TASK_LEASE_MS);
		expect(await service().recordFailure(flaky.id, 'Timed out', NOW)).toBe('retry');
		expect(await read(flaky.id)).toMatchObject({ status: 'queued', attempts: 1, lastError: 'Timed out', runAt: NOW + TASK_RETRY_DELAYS_MS[0], leaseUntil: null });

		let now = NOW + TASK_RETRY_DELAYS_MS[0];
		await service().claimNext('seller_1', now, TASK_LEASE_MS);
		await service().saveStep(flaky.id, { progress: progress(40, 80), credits: 5, steps: 1 }, now);
		expect(await read(flaky.id)).toMatchObject({ status: 'running', attempts: 0, lastError: null });

		for (let failure = 1; failure < TASK_MAX_FAILURES; failure += 1) {
			await service().claimNext('seller_1', now, TASK_LEASE_MS);
			expect(await service().recordFailure(flaky.id, `Failure ${failure}`, now)).toBe('retry');
			const task = await read(flaky.id);
			expect(task).toMatchObject({ attempts: failure, runAt: now + TASK_RETRY_DELAYS_MS[failure - 1] });
			now = task.runAt;
		}
		await service().claimNext('seller_1', now, TASK_LEASE_MS);
		expect(await service().recordFailure(flaky.id, 'Failure 5', now)).toBe('failed');
		expect(await read(flaky.id)).toMatchObject({ status: 'failed', attempts: TASK_MAX_FAILURES, lastError: 'Failure 5', finishedAt: now, progress: progress(40, 80), steps: 1 });

		// A task that isn't running is left alone.
		expect(await service().recordFailure(flaky.id, 'Late', now + 1)).toBe('failed');
		expect(await read(flaky.id)).toMatchObject({ lastError: 'Failure 5', attempts: TASK_MAX_FAILURES });
	});

	it('pause and defer keep the progress, and the task continues at its next step', async () => {
		const task = await queued('seller_1', 'long');
		await service().claimNext('seller_1', NOW, TASK_LEASE_MS);
		await service().saveStep(task.id, { progress: progress(40, 120), credits: 9, steps: 1 }, NOW);

		await service().claimNext('seller_1', NOW + 1, TASK_LEASE_MS);
		await service().defer(task.id, NOW + 3 * HOUR, 'daily-limit');
		expect(await read(task.id)).toMatchObject({ status: 'queued', pauseReason: 'daily-limit', runAt: NOW + 3 * HOUR, leaseUntil: null, progress: progress(40, 120), steps: 1 });
		expect(await service().claimNext('seller_1', NOW + HOUR, TASK_LEASE_MS)).toBeNull();
		expect(await service().nextRunAt('seller_1')).toBe(NOW + 3 * HOUR);
		expect(await service().claimNext('seller_1', NOW + 3 * HOUR, TASK_LEASE_MS)).toMatchObject({ id: task.id, pauseReason: null, steps: 1, creditsUsed: 9 });

		await service().pause(task.id, 'credits');
		expect(await service().claimNext('seller_1', NOW + 4 * HOUR, TASK_LEASE_MS)).toBeNull();
		expect(await service().nextRunAt('seller_1')).toBeNull();
		await service().resume(task.id, 'seller_1', NOW + 5 * HOUR);
		expect(await service().claimNext('seller_1', NOW + 5 * HOUR, TASK_LEASE_MS)).toMatchObject({ id: task.id, progress: progress(40, 120), steps: 1, creditsUsed: 9 });
	});

	it('a step saved after the seller canceled keeps the cancel, and the same step saved twice counts once', async () => {
		const task = await queued('seller_1', 'canceled-mid-step');
		await service().claimNext('seller_1', NOW, TASK_LEASE_MS);
		await service().cancel(task.id, 'seller_1', NOW + 1);

		await service().saveStep(task.id, { progress: progress(40, 100), credits: 9, steps: 1 }, NOW + 2);
		await service().saveStep(task.id, { progress: progress(40, 100), credits: 9, steps: 1 }, NOW + 3);
		await service().finish(task.id, NOW + 4);
		await service().fail(task.id, 'Too late', NOW + 4);

		expect(await read(task.id)).toMatchObject({ status: 'canceled', finishedAt: NOW + 1, progress: progress(40, 100), creditsUsed: 9, steps: 1, lastError: null });
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
