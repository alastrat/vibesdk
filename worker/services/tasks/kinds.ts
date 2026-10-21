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
	/**
	 * Ends the task as failed, after saving and charging this step, with this message for the seller: English marked with
	 * `msg()`, naming no AI provider or supplier. `onFinished` doesn't run.
	 */
	failed?: string;
	/** On a finishing step, whether what the task made is ready to use; `onFinished` reads it. */
	ready?: boolean;
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
	 * Asked before each step, ahead of any credit check or model call: the time to ask again when the kind won't take a
	 * step now, such as while its pause flag is on, or null to go ahead. A held task keeps its progress and spends nothing.
	 */
	hold?(ctx: TaskStepContext, payload: P): Promise<number | null>;
	/**
	 * One bounded piece of work, such as one model call. It must be safe to repeat: a step whose save was lost runs
	 * again under the same step number.
	 */
	step(ctx: TaskStepContext, payload: P): Promise<TaskStepResult>;
	/**
	 * Runs once the last step says finished, before the task is marked done; a throw retries the task. `result` is that
	 * step's own, since `ctx.task` is the task as it was claimed, before the step's progress was saved.
	 */
	onFinished?(ctx: TaskStepContext, payload: P, result: TaskStepResult): Promise<void>;
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
