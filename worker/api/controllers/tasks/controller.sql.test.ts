/**
 * The seller's tasks API on real SQL, with the seller's runner and analytics stood in: a seller sees and changes only
 * their own tasks, a cancel is reported to analytics without ever failing the request, and a resume wakes the runner.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { envWith, insertApp, insertUser, migratedD1 } from '../../../database/test-support/real-d1';
import { TaskService } from '../../../database/services/TaskService';
import { translationDedupeKey } from '../../../services/store-translations/translate-kind';
import { MAX_UNFINISHED_TASKS } from '../../../../shared/types/tasks';
import type { RouteContext } from '../../types/route-context';
import { TasksController } from './controller';

const analytics = vi.hoisted((): { events: Array<[string, string, unknown]>; failing: boolean } => ({ events: [], failing: false }));
vi.mock('../../../services/posthog/analytics', () => ({
	serverAnalytics: () => ({
		capture: (name: string, userId: string, properties: unknown) => {
			if (analytics.failing) throw new Error('PostHog is down');
			analytics.events.push([name, userId, properties]);
		},
	}),
}));

let db: D1Database;
let woke: string[];

beforeAll(async () => {
	db = await migratedD1();
	for (const id of ['seller_1', 'seller_2']) await insertUser(db, id);
	await insertApp(db, { id: 'app_a', userId: 'seller_1' });
	await insertApp(db, { id: 'app_b', userId: 'seller_1' });
	await insertApp(db, { id: 'app_c', userId: 'seller_2' });
});

beforeEach(() => {
	woke = [];
	analytics.events.length = 0;
	analytics.failing = false;
	vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

const env = (): Env => envWith(db, { TASK_RUNNER: { idFromName: (name: string) => name, get: () => ({ wake: async (userId: string) => void woke.push(userId) }) } });
const as = (userId: string, pathParams: Record<string, string> = {}, query = '') => ({ user: { id: userId, email: `${userId}@example.test` }, pathParams, queryParams: new URLSearchParams(query) }) as unknown as RouteContext;
const ctx = {} as ExecutionContext;
const call = async (method: 'list' | 'cancel' | 'resume', context: RouteContext) => {
	const response = await TasksController[method](new Request('https://estori.app/api/tasks', { method: method === 'list' ? 'GET' : 'POST' }), env(), ctx, context);
	return { status: response.status, body: (await response.json()) as { data?: any; error?: { message?: string } } };
};

async function queue(userId: string, appId: string, locale: 'es' | 'pt-BR' = 'es', at = Date.now()): Promise<string> {
	const queued = await new TaskService(envWith(db)).enqueue({ userId, appId, kind: 'store.translate', payload: { appId, locale }, dedupeKey: translationDedupeKey(appId, locale), now: at });
	if ('refused' in queued) throw new Error('refused');
	return queued.task.id;
}

const setStatus = (id: string, status: string, extra = '') => db.prepare(`UPDATE tasks SET status = ?${extra} WHERE id = ?`).bind(status, id).run();
const statusOf = async (id: string) => (await db.prepare('SELECT status FROM tasks WHERE id = ?').bind(id).first<{ status: string }>())?.status;

describe("the seller's tasks", () => {
	it('tasks list is scoped to the seller, newest first, and to one store when asked', async () => {
		const [oldest, newest, otherStore] = [await queue('seller_1', 'app_a', 'es', 1_000), await queue('seller_1', 'app_a', 'pt-BR', 2_000), await queue('seller_1', 'app_b', 'es', 3_000)];
		const others = await queue('seller_2', 'app_c', 'es', 4_000);

		const all = await call('list', as('seller_1'));
		expect(all.status).toBe(200);
		expect(all.body.data.map((task: { id: string }) => task.id)).toEqual([otherStore, newest, oldest]);
		expect(all.body.data[0]).toMatchObject({ kind: 'store.translate', appId: 'app_b', status: 'queued', payload: { locale: 'es' }, progress: { done: 0, total: 0, skipped: 0 } });
		expect(JSON.stringify(all.body.data)).not.toContain('skippedHashes');

		const oneStore = await call('list', as('seller_1', {}, 'appId=app_a'));
		expect(oneStore.body.data.map((task: { id: string }) => task.id)).toEqual([newest, oldest]);
		expect((await call('list', as('seller_2'))).body.data.map((task: { id: string }) => task.id)).toEqual([others]);
		// Asking for a store that is not theirs shows nothing of it.
		expect((await call('list', as('seller_2', {}, 'appId=app_a'))).body.data).toEqual([]);
		expect((await call('list', as('seller_1', {}, 'appId=app_gone'))).body.data).toEqual([]);
	});

	it('lists at most the latest 50, and a task whose payload cannot be read is left out', async () => {
		const service = new TaskService(envWith(db));
		for (let index = 0; index < 55; index += 1) {
			await db
				.prepare(`INSERT INTO tasks (id, user_id, app_id, kind, status, payload, dedupe_key, run_at, created_at, finished_at) VALUES (?, 'seller_1', 'app_a', 'store.translate', 'done', ?, ?, ?, ?, ?)`)
				.bind(`task_${index}`, JSON.stringify({ appId: 'app_a', locale: 'es' }), `done:${index}`, index, index, index)
				.run();
		}
		await db.prepare(`UPDATE tasks SET payload = '{"locale":"fr"}' WHERE id = 'task_54'`).run();
		const listed = await call('list', as('seller_1'));
		expect(listed.body.data).toHaveLength(49);
		expect(listed.body.data[0].id).toBe('task_53');
		expect(await service.listForUser('seller_1', { limit: 100 })).toHaveLength(55);
	});

	it('cancels a task of the seller, reports it to analytics, and leaves the runner alone', async () => {
		const id = await queue('seller_1', 'app_a');
		await db.prepare("UPDATE tasks SET credits_used = 12, steps = 3 WHERE id = ?").bind(id).run();
		const canceled = await call('cancel', as('seller_1', { id }));
		expect(canceled.status).toBe(200);
		expect(canceled.body.data).toMatchObject({ id, status: 'canceled' });
		expect(canceled.body.data.finishedAt).toMatch(/^\d{4}-/);
		expect(await statusOf(id)).toBe('canceled');
		expect(analytics.events).toEqual([['task_finished', 'seller_1', { kind: 'store.translate', status: 'canceled', credits_used: 12, steps: 3 }]]);
		expect(woke).toEqual([]);
	});

	it("answers 404 for a task of another seller, one that doesn't exist, or one that has finished, canceling and reporting nothing", async () => {
		const mine = await queue('seller_1', 'app_a');
		const theirs = await queue('seller_2', 'app_c');
		const finished = await queue('seller_1', 'app_b');
		await setStatus(finished, 'done');

		for (const id of [theirs, 'task_gone', finished]) expect((await call('cancel', as('seller_1', { id }))).status, id).toBe(404);
		expect(await statusOf(theirs)).toBe('queued');
		expect(await statusOf(finished)).toBe('done');
		expect(analytics.events).toEqual([]);
		// The other seller can't touch mine either.
		expect((await call('cancel', as('seller_2', { id: mine }))).status).toBe(404);
		expect(await statusOf(mine)).toBe('queued');
	});

	it('a failing analytics call cannot fail the cancel', async () => {
		const id = await queue('seller_1', 'app_a');
		analytics.failing = true;
		const canceled = await call('cancel', as('seller_1', { id }));
		expect(canceled.status).toBe(200);
		expect(await statusOf(id)).toBe('canceled');
	});

	it('resumes a paused or failed task of the seller where it stopped, and wakes their runner', async () => {
		const paused = await queue('seller_1', 'app_a', 'es');
		await setStatus(paused, 'paused', ", pause_reason = 'credits'");
		const resumed = await call('resume', as('seller_1', { id: paused }));
		expect(resumed.status).toBe(200);
		expect(resumed.body.data).toMatchObject({ id: paused, status: 'queued', pauseReason: null });
		expect(woke).toEqual(['seller_1']);

		const failed = await queue('seller_1', 'app_b', 'pt-BR');
		await setStatus(failed, 'failed', ", last_error = 'Something went wrong', finished_at = 1");
		const retried = await call('resume', as('seller_1', { id: failed }));
		expect(retried.body.data).toMatchObject({ id: failed, status: 'queued', lastError: null, finishedAt: null });
		expect(woke).toEqual(['seller_1', 'seller_1']);
	});

	it("answers 404 when resuming another seller's task or one that doesn't exist, waking nothing", async () => {
		const theirs = await queue('seller_2', 'app_c');
		await setStatus(theirs, 'paused', ", pause_reason = 'credits'");
		expect((await call('resume', as('seller_1', { id: theirs }))).status).toBe(404);
		expect((await call('resume', as('seller_1', { id: 'task_gone' }))).status).toBe(404);
		expect(await statusOf(theirs)).toBe('paused');
		expect(woke).toEqual([]);
	});

	it('answers 409 when the seller\'s task cannot be resumed: it is not stopped, or the same work was queued again', async () => {
		const queued = await queue('seller_1', 'app_a', 'es');
		const notStopped = await call('resume', as('seller_1', { id: queued }));
		expect(notStopped.status).toBe(409);
		expect(notStopped.body.error?.message).toContain("can't be resumed");

		await setStatus(queued, 'failed', ', finished_at = 1');
		const again = await queue('seller_1', 'app_a', 'es');
		expect(again).not.toBe(queued);
		expect((await call('resume', as('seller_1', { id: queued }))).status).toBe(409);
		expect(await statusOf(queued)).toBe('failed');
		expect(woke).toEqual([]);
	});

	it('answers 409 when resuming a failed task would pass the limit of unfinished tasks', async () => {
		const failed = await queue('seller_1', 'app_a', 'es');
		await setStatus(failed, 'failed', ', finished_at = 1');
		for (let index = 0; index < MAX_UNFINISHED_TASKS; index += 1) {
			await db
				.prepare(`INSERT INTO tasks (id, user_id, app_id, kind, status, payload, dedupe_key, run_at, created_at) VALUES (?, 'seller_1', NULL, 'store.translate', 'queued', '{}', ?, 0, 0)`)
				.bind(`full_${index}`, `full:${index}`)
				.run();
		}
		expect((await call('resume', as('seller_1', { id: failed }))).status).toBe(409);
		expect(await statusOf(failed)).toBe('failed');
	});

	it("words a refusal in the seller's saved language", async () => {
		await db.prepare(`UPDATE users SET preferences = '{"locale":"es"}' WHERE id = 'seller_2'`).run();
		const refusal = await call('cancel', as('seller_2', { id: 'task_gone' }));
		expect(refusal.status).toBe(404);
		expect(refusal.body.error?.message).toBe('Esa tarea no existe o ya terminó.');
	});
});
