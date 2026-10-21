/** The kinds of seller task: each is a handler that reads its payload and does one bounded, repeatable step at a time. */

import type { TaskKind, TaskProgress } from '../../../shared/types/tasks';
import type { TaskRecord } from '../../database/services/TaskService';
import type { StepUsage } from '../billing/step-credits';
import { storeTranslateKind } from '../store-translations/translate-kind';

/** One model call a step made, for its credits. */
export interface ModelCall {
	model: string;
	usage: StepUsage | null;
}

export interface TaskStepResult {
	progress: TaskProgress;
	finished: boolean;
	calls: ModelCall[];
}

export interface TaskStepContext {
	env: Env;
	task: TaskRecord;
	now: number;
}

export interface TaskKindHandler<P> {
	kind: TaskKind;
	/** The payload, or null when it can't be read; the task then fails without retrying. */
	parsePayload(raw: unknown): P | null;
	/**
	 * One bounded piece of work, such as one model call. It must be safe to repeat: a step whose save was lost runs
	 * again under the same step number.
	 */
	step(ctx: TaskStepContext, payload: P): Promise<TaskStepResult>;
	/** Runs once the last step says finished, before the task is marked done; a throw retries the task. */
	onFinished?(ctx: TaskStepContext, payload: P): Promise<void>;
	/**
	 * What the seller sees for an error `step` or `onFinished` threw: English marked with `msg()`, naming no AI provider or
	 * supplier. Left out, or null for an error the kind doesn't know, the queue's generic message is shown. The raw error
	 * is only logged.
	 */
	describeError?(error: unknown): string | null;
}

const handlers = new Map<TaskKind, TaskKindHandler<unknown>>();

export function registerTaskKind<P>(handler: TaskKindHandler<P>): void {
	handlers.set(handler.kind, handler);
}

export function taskKind(kind: TaskKind): TaskKindHandler<unknown> | null {
	return handlers.get(kind) ?? null;
}

registerTaskKind(storeTranslateKind);
