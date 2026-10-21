/**
 * D1 for the seller task queue. The seller's runner claims one due task at a time under a lease, saves each step, and
 * records failures; sellers queue, cancel and resume their own tasks. Times are epoch milliseconds.
 */

import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { generateId } from '../../utils/idGenerator';
import {
	MAX_UNFINISHED_TASKS,
	UNFINISHED_TASK_STATUSES,
	taskRetryAt,
	type TaskKind,
	type TaskPauseReason,
	type TaskProgress,
	type TaskStatus,
} from '../../../shared/types/tasks';

export interface TaskRecord {
	id: string;
	userId: string;
	appId: string | null;
	kind: TaskKind;
	status: TaskStatus;
	/** The kind's payload, as stored; the kind reads it. */
	payload: unknown;
	progress: TaskProgress;
	creditsUsed: number;
	/** Failures in a row. */
	attempts: number;
	/** Steps saved so far, which is also the next step's number. */
	steps: number;
	lastError: string | null;
	pauseReason: TaskPauseReason | null;
	runAt: number;
	leaseUntil: number | null;
	dedupeKey: string;
	createdAt: number;
	startedAt: number | null;
	finishedAt: number | null;
}

export interface EnqueueTask {
	userId: string;
	appId: string | null;
	kind: TaskKind;
	payload: Record<string, unknown>;
	/** Names the work; while a task with this key is unfinished, queuing it again returns that task. */
	dedupeKey: string;
	/** When to run; now when left out. */
	runAt?: number;
	now?: number;
}

export type EnqueueResult = { task: TaskRecord; created: boolean } | { refused: 'limit' };

type TaskRow = typeof schema.tasks.$inferSelect;

/** Tasks the runner may take: waiting, or between steps. */
const CLAIMABLE_STATUSES: readonly TaskStatus[] = ['queued', 'running'];
const RESUMABLE_STATUSES: readonly TaskStatus[] = ['paused', 'failed'];
const statusList = (statuses: readonly TaskStatus[]): SQL => sql.raw(statuses.map((status) => `'${status}'`).join(', '));
const CLAIMABLE_SQL = statusList(CLAIMABLE_STATUSES);
const UNFINISHED_SQL = statusList(UNFINISHED_TASK_STATUSES);
const EMPTY_PROGRESS: TaskProgress = { done: 0, total: 0, skipped: 0 };

function parsed(json: string): unknown {
	try {
		return JSON.parse(json);
	} catch {
		return null;
	}
}

const countOf = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

function progressOf(json: string): TaskProgress {
	const value = parsed(json);
	if (typeof value !== 'object' || value === null) return { ...EMPTY_PROGRESS };
	const { done, total, skipped } = value as Record<string, unknown>;
	return { done: countOf(done), total: countOf(total), skipped: countOf(skipped) };
}

function recordOf(row: TaskRow): TaskRecord {
	return { ...row, payload: parsed(row.payload), progress: progressOf(row.progress) };
}

/** A task that never ran a step shows no start time, though a claim set one. */
function startedIfStepped(): SQL {
	return sql`CASE WHEN ${schema.tasks.steps} = 0 THEN NULL ELSE ${schema.tasks.startedAt} END`;
}

/** No task of this seller holds a live lease: the seller's runner does one step at a time. */
function noLiveLease(userId: SQL | string, now: number): SQL {
	return sql`NOT EXISTS (SELECT 1 FROM tasks l WHERE l.user_id = ${userId} AND l.status = 'running' AND l.lease_until > ${now})`;
}

export class TaskService extends BaseService {
	/**
	 * Queues work once: while a task with the same key is unfinished, that task is returned instead. One statement checks
	 * the seller's limit and the key, so two quick requests can't queue the same work twice.
	 */
	async enqueue(input: EnqueueTask): Promise<EnqueueResult> {
		const id = generateId();
		const now = input.now ?? Date.now();
		const inserted = await this.database.run(sql`INSERT INTO tasks (id, user_id, app_id, kind, status, payload, run_at, dedupe_key, created_at)
			SELECT ${id}, ${input.userId}, ${input.appId}, ${input.kind}, 'queued', ${JSON.stringify(input.payload)}, ${input.runAt ?? now}, ${input.dedupeKey}, ${now}
			WHERE (SELECT count(*) FROM tasks WHERE user_id = ${input.userId} AND status IN (${UNFINISHED_SQL})) < ${MAX_UNFINISHED_TASKS}
			ON CONFLICT DO NOTHING`);
		if (inserted.meta.changes > 0) {
			const task = await this.find(eq(schema.tasks.id, id));
			if (task) return { task, created: true };
		}
		const existing = await this.find(
			and(eq(schema.tasks.userId, input.userId), eq(schema.tasks.dedupeKey, input.dedupeKey), inArray(schema.tasks.status, UNFINISHED_TASK_STATUSES)),
		);
		return existing ? { task: existing, created: false } : { refused: 'limit' };
	}

	/**
	 * Takes the seller's earliest due task for one step, holding it until `now + leaseMs`: a queued task, one between
	 * steps, or one whose lease ran out because its step was lost. Null while another of the seller's tasks holds a lease.
	 */
	async claimNext(userId: string, now: number, leaseMs: number): Promise<TaskRecord | null> {
		const tasks = schema.tasks;
		const [row] = await this.database
			.update(tasks)
			.set({ status: 'running', leaseUntil: now + leaseMs, startedAt: sql`COALESCE(${tasks.startedAt}, ${now})`, pauseReason: null })
			.where(
				eq(
					tasks.id,
					sql`(SELECT c.id FROM tasks c
						WHERE c.user_id = ${userId} AND c.status IN (${CLAIMABLE_SQL}) AND c.run_at <= ${now}
							AND (c.lease_until IS NULL OR c.lease_until <= ${now}) AND ${noLiveLease(userId, now)}
						ORDER BY c.run_at, c.created_at, c.id LIMIT 1)`,
				),
			)
			.returning();
		return row ? recordOf(row) : null;
	}

	/**
	 * Saves a step's progress and credits, and releases the lease; the task is due again at once, behind the seller's other
	 * due work. Saves each step once, and never changes the status, so a seller's cancel during the step stands. A step
	 * that isn't the last clears the failure count; the last one leaves it to `finish`, so a finish that keeps failing
	 * still counts. Answers the task's status, or null when this step was saved already.
	 */
	async saveStep(id: string, step: { progress: TaskProgress; credits: number; steps: number; finished: boolean }, now: number): Promise<TaskStatus | null> {
		const tasks = schema.tasks;
		const [row] = await this.database
			.update(tasks)
			.set({
				progress: JSON.stringify(step.progress),
				creditsUsed: sql`${tasks.creditsUsed} + ${step.credits}`,
				steps: step.steps,
				leaseUntil: null,
				runAt: now,
				...(step.finished ? {} : { attempts: 0, lastError: null }),
			})
			.where(and(eq(tasks.id, id), eq(tasks.steps, step.steps - 1)))
			.returning({ status: tasks.status });
		return row?.status ?? null;
	}

	async finish(id: string, now: number): Promise<void> {
		await this.updateRunning(id, { status: 'done', finishedAt: now, leaseUntil: null, pauseReason: null, attempts: 0, lastError: null });
	}

	/** Fails a task for good, without retries, such as one whose payload can't be read. */
	async fail(id: string, message: string, now: number): Promise<void> {
		await this.updateRunning(id, { status: 'failed', lastError: message, finishedAt: now, leaseUntil: null });
	}

	/**
	 * A step failed: the task waits out its backoff showing `messages.retry`, or fails at the last failure in a row showing
	 * `messages.failed`. 'failed' also when the task was no longer running, since it won't run again.
	 */
	async recordFailure(id: string, messages: { retry: string; failed: string }, now: number): Promise<'retry' | 'failed'> {
		const tasks = schema.tasks;
		const current = await this.database.select({ attempts: tasks.attempts }).from(tasks).where(and(eq(tasks.id, id), eq(tasks.status, 'running'))).get();
		if (!current) return 'failed';
		const failures = current.attempts + 1;
		const retryAt = taskRetryAt(failures, now);
		const update =
			retryAt === null
				? { status: 'failed' as const, attempts: failures, lastError: messages.failed, finishedAt: now, leaseUntil: null }
				: { status: 'queued' as const, attempts: failures, lastError: messages.retry, runAt: retryAt, leaseUntil: null };
		await this.database
			.update(tasks)
			.set(update)
			.where(and(eq(tasks.id, id), eq(tasks.status, 'running'), eq(tasks.attempts, current.attempts)))
			.run();
		return retryAt === null ? 'failed' : 'retry';
	}

	/** Stops a task until it's resumed; its progress is kept. */
	async pause(id: string, reason: TaskPauseReason): Promise<void> {
		const tasks = schema.tasks;
		await this.database
			.update(tasks)
			.set({ status: 'paused', pauseReason: reason, leaseUntil: null, startedAt: startedIfStepped() })
			.where(and(eq(tasks.id, id), inArray(tasks.status, CLAIMABLE_STATUSES)))
			.run();
	}

	/** Holds a task until `runAt`, showing why; it runs again then on its own. */
	async defer(id: string, runAt: number, reason: TaskPauseReason): Promise<void> {
		const tasks = schema.tasks;
		await this.database
			.update(tasks)
			.set({ status: 'queued', runAt, pauseReason: reason, leaseUntil: null, startedAt: startedIfStepped() })
			.where(and(eq(tasks.id, id), inArray(tasks.status, CLAIMABLE_STATUSES)))
			.run();
	}

	/**
	 * The seller's Resume or Retry: a paused or failed task of theirs is queued again where it stopped. Null when there's
	 * no such task, the same work was queued again since, or a failed task would take the seller past their limit.
	 */
	async resume(id: string, userId: string, now: number = Date.now()): Promise<TaskRecord | null> {
		const tasks = schema.tasks;
		const [row] = await this.database
			.update(tasks)
			.set({ status: 'queued', pauseReason: null, attempts: 0, lastError: null, finishedAt: null, leaseUntil: null, runAt: now })
			.where(
				and(
					eq(tasks.id, id),
					eq(tasks.userId, userId),
					inArray(tasks.status, RESUMABLE_STATUSES),
					sql`NOT EXISTS (SELECT 1 FROM tasks o WHERE o.user_id = tasks.user_id AND o.dedupe_key = tasks.dedupe_key AND o.status IN (${UNFINISHED_SQL}) AND o.id <> tasks.id)`,
					// A paused task already counts toward the limit; a failed one would add to it.
					sql`(tasks.status IN (${UNFINISHED_SQL}) OR (SELECT count(*) FROM tasks u WHERE u.user_id = tasks.user_id AND u.status IN (${UNFINISHED_SQL})) < ${MAX_UNFINISHED_TASKS})`,
				),
			)
			.returning();
		return row ? recordOf(row) : null;
	}

	/** The seller's Cancel: an unfinished task of theirs stops for good. Null when there's no such task. */
	async cancel(id: string, userId: string, now: number = Date.now()): Promise<TaskRecord | null> {
		const tasks = schema.tasks;
		const [row] = await this.database
			.update(tasks)
			.set({ status: 'canceled', finishedAt: now, leaseUntil: null })
			.where(and(eq(tasks.id, id), eq(tasks.userId, userId), inArray(tasks.status, UNFINISHED_TASK_STATUSES)))
			.returning();
		return row ? recordOf(row) : null;
	}

	/** When the seller's runner can next take a step: the earliest run_at, after any live lease; null with nothing to run. */
	async nextRunAt(userId: string): Promise<number | null> {
		const tasks = schema.tasks;
		const row = await this.database
			.select({ next: sql<number | null>`min(${tasks.runAt})`, lease: sql<number | null>`max(${tasks.leaseUntil})` })
			.from(tasks)
			.where(and(eq(tasks.userId, userId), inArray(tasks.status, CLAIMABLE_STATUSES)))
			.get();
		const next = row?.next ?? null;
		return next === null ? null : Math.max(next, row?.lease ?? 0);
	}

	/** The seller's tasks, newest first, for one store or all. */
	async listForUser(userId: string, options: { appId?: string; limit: number }): Promise<TaskRecord[]> {
		const tasks = schema.tasks;
		const rows = await this.database
			.select()
			.from(tasks)
			.where(and(eq(tasks.userId, userId), options.appId === undefined ? undefined : eq(tasks.appId, options.appId)))
			.orderBy(desc(tasks.createdAt), desc(tasks.id))
			.limit(options.limit)
			.all();
		return rows.map(recordOf);
	}

	/** Sellers with a task due and no live lease: their runner has work and isn't in a step, so waking it is safe. */
	async dueUserIds(now: number, limit: number): Promise<string[]> {
		const tasks = schema.tasks;
		const rows = await this.database
			.selectDistinct({ userId: tasks.userId })
			.from(tasks)
			.where(
				and(
					inArray(tasks.status, CLAIMABLE_STATUSES),
					sql`${tasks.runAt} <= ${now}`,
					sql`(${tasks.leaseUntil} IS NULL OR ${tasks.leaseUntil} <= ${now})`,
					noLiveLease(sql`tasks.user_id`, now),
				),
			)
			.limit(limit)
			.all();
		return rows.map((row) => row.userId);
	}

	/** Sellers with a task paused for this reason, such as credits running out. */
	async pausedUserIds(reason: TaskPauseReason, limit: number): Promise<string[]> {
		const tasks = schema.tasks;
		const rows = await this.database
			.selectDistinct({ userId: tasks.userId })
			.from(tasks)
			.where(and(eq(tasks.status, 'paused'), eq(tasks.pauseReason, reason)))
			.limit(limit)
			.all();
		return rows.map((row) => row.userId);
	}

	/** The ids of the seller's tasks paused for this reason. */
	async pausedTaskIds(userId: string, reason: TaskPauseReason): Promise<string[]> {
		const tasks = schema.tasks;
		const rows = await this.database
			.select({ id: tasks.id })
			.from(tasks)
			.where(and(eq(tasks.userId, userId), eq(tasks.status, 'paused'), eq(tasks.pauseReason, reason)))
			.all();
		return rows.map((row) => row.id);
	}

	private async find(where: SQL | undefined): Promise<TaskRecord | null> {
		const row = await this.database.select().from(schema.tasks).where(where).get();
		return row ? recordOf(row) : null;
	}

	/** The runner's writes after a step apply only while the task is still running, so a seller's cancel stands. */
	private async updateRunning(id: string, update: Partial<typeof schema.tasks.$inferInsert>): Promise<void> {
		const tasks = schema.tasks;
		await this.database
			.update(tasks)
			.set(update)
			.where(and(eq(tasks.id, id), eq(tasks.status, 'running')))
			.run();
	}
}
