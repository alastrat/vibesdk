/**
 * What one alarm of a seller's task runner does: claim the seller's next due task under a lease, check the meter, run
 * one step, charge and save it, and say when to run again. Pure apart from its dependencies.
 */

import { TASK_LEASE_MS, type TaskKind } from '../../../shared/types/tasks';
import type { TaskRecord, TaskService } from '../../database/services/TaskService';
import type { TaskKindHandler, TaskStepContext, TaskStepResult } from './kinds';
import type { TaskMeter } from './meter';

export type TaskStore = Pick<TaskService, 'claimNext' | 'saveStep' | 'finish' | 'fail' | 'recordFailure' | 'pause' | 'defer' | 'nextRunAt'>;

export interface TaskRunnerDeps {
	store: TaskStore;
	meter: TaskMeter;
	kinds: (kind: TaskKind) => TaskKindHandler<unknown> | null;
	env: Env;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function runTaskTick(deps: TaskRunnerDeps, userId: string, now: number): Promise<{ nextAlarmAt: number | null }> {
	const task = await deps.store.claimNext(userId, now, TASK_LEASE_MS);
	if (task) await runStep(deps, task, now);
	const next = await deps.store.nextRunAt(userId);
	return { nextAlarmAt: next === null ? null : Math.max(next, now) };
}

async function runStep(deps: TaskRunnerDeps, task: TaskRecord, now: number): Promise<void> {
	const handler = deps.kinds(task.kind);
	if (!handler) {
		await deps.store.fail(task.id, `Unknown task kind: ${task.kind}`, now);
		return;
	}
	const payload = handler.parsePayload(task.payload);
	if (payload === null) {
		await deps.store.fail(task.id, "The task's details could not be read", now);
		return;
	}

	const gate = await deps.meter.gate(task.userId);
	if (!gate.ok) {
		if (gate.resumeAt === null) await deps.store.pause(task.id, gate.reason);
		else await deps.store.defer(task.id, gate.resumeAt, gate.reason);
		return;
	}

	const ctx: TaskStepContext = { env: deps.env, task, now };
	let result: TaskStepResult;
	try {
		result = await handler.step(ctx, payload);
	} catch (error) {
		await deps.store.recordFailure(task.id, errorText(error), now);
		return;
	}
	// A lost save leaves `steps` as it was, so the repeated step is charged under the same keys and counts once.
	const credits = await deps.meter.charge({ userId: task.userId, taskId: task.id, step: task.steps, calls: result.calls });
	await deps.store.saveStep(task.id, { progress: result.progress, credits, steps: task.steps + 1 }, now);
	if (!result.finished) return;

	try {
		await handler.onFinished?.(ctx, payload);
	} catch (error) {
		await deps.store.recordFailure(task.id, errorText(error), now);
		return;
	}
	await deps.store.finish(task.id, now);
}
