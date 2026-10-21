/**
 * What one alarm of a seller's task runner does: claim the seller's next due task under a lease, check the meter, run
 * one step, charge and save it, and say when to run again. Pure apart from its dependencies and logging.
 */

import { TASK_FAILED_MESSAGE, TASK_LEASE_MS, TASK_RETRY_MESSAGE, type TaskKind } from '../../../shared/types/tasks';
import type { TaskRecord, TaskService } from '../../database/services/TaskService';
import { createLogger } from '../../logger';
import type { TaskKindHandler, TaskStepContext } from './kinds';
import type { TaskMeter } from './meter';

export type TaskStore = Pick<TaskService, 'claimNext' | 'saveStep' | 'finish' | 'fail' | 'recordFailure' | 'pause' | 'defer' | 'nextRunAt'>;

export interface TaskRunnerDeps {
	store: TaskStore;
	meter: TaskMeter;
	kinds: (kind: TaskKind) => TaskKindHandler<unknown> | null;
	env: Env;
}

const logger = createLogger('TaskRunner');

/** What the kind's own code threw, kept apart from the queue's errors so only the kind describes it to the seller. */
class KindError extends Error {
	constructor(readonly original: unknown) {
		super('The task kind failed');
	}
}

async function fromKind<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		throw new KindError(error);
	}
}

function describedByKind(handler: TaskKindHandler<unknown>, error: unknown): string | null {
	if (!handler.describeError) return null;
	try {
		return handler.describeError(error);
	} catch {
		return null;
	}
}

export async function runTaskTick(deps: TaskRunnerDeps, userId: string, now: number): Promise<{ nextAlarmAt: number | null }> {
	const task = await deps.store.claimNext(userId, now, TASK_LEASE_MS);
	if (task) await runStep(deps, task, now);
	const next = await deps.store.nextRunAt(userId);
	return { nextAlarmAt: next === null ? null : Math.max(next, now) };
}

async function runStep(deps: TaskRunnerDeps, task: TaskRecord, now: number): Promise<void> {
	const handler = deps.kinds(task.kind);
	const payload = handler ? handler.parsePayload(task.payload) : null;
	if (!handler || payload === null) {
		logger.error(handler ? "A task's payload could not be read; failing it" : "A task's kind is not registered; failing it", { taskId: task.id, kind: task.kind });
		await deps.store.fail(task.id, TASK_FAILED_MESSAGE, now);
		return;
	}

	// Any error here, the meter's and the save's included, counts toward the task's failures, so it backs off and stops.
	try {
		const gate = await deps.meter.gate(task.userId);
		if (!gate.ok) {
			if (gate.resumeAt === null) await deps.store.pause(task.id, gate.reason);
			else await deps.store.defer(task.id, gate.resumeAt, gate.reason);
			return;
		}

		const ctx: TaskStepContext = { env: deps.env, task, now };
		const result = await fromKind(() => handler.step(ctx, payload));
		// A failed save leaves `steps` as it was, so the repeated step is charged under the same keys and counts once.
		const credits = await deps.meter.charge({ userId: task.userId, taskId: task.id, step: task.steps, calls: result.calls });
		const status = await deps.store.saveStep(task.id, { progress: result.progress, credits, steps: task.steps + 1, finished: result.finished }, now);
		// Canceled during the step: the work it did is saved, and nothing more runs.
		if (!result.finished || status !== 'running') return;

		await fromKind(async () => handler.onFinished?.(ctx, payload));
		await deps.store.finish(task.id, now);
	} catch (error) {
		const original = error instanceof KindError ? error.original : error;
		logger.error('A task step failed', { taskId: task.id, kind: task.kind, error: original });
		const described = error instanceof KindError ? describedByKind(handler, original) : null;
		await deps.store.recordFailure(task.id, { retry: described ?? TASK_RETRY_MESSAGE, failed: described ?? TASK_FAILED_MESSAGE }, now);
	}
}
