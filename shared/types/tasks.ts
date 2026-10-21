/**
 * The seller task queue (spec 2026-10-21, section 6): background work a seller queues, such as translating a store, run
 * one bounded step at a time by the seller's own runner, with progress, retries, pausing and credits per task.
 */

import type { Locale } from '../i18n/locales';
import { msg } from '../i18n/translate';

export const TASK_STATUSES = ['queued', 'running', 'paused', 'done', 'failed', 'canceled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** A task in one of these holds its dedupe key and counts toward the seller's limit. */
export const UNFINISHED_TASK_STATUSES = ['queued', 'running', 'paused'] as const satisfies readonly TaskStatus[];

/** Whether a task in this status is still queued, running or paused. */
export function isUnfinishedStatus(status: TaskStatus): boolean {
	return UNFINISHED_TASK_STATUSES.some((unfinished) => unfinished === status);
}

export const TASK_KINDS = ['store.translate'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** Why a task waits: out of credits, the daily allowance used up until `runAt`, or the seller paused it. */
export const TASK_PAUSE_REASONS = ['credits', 'daily-limit', 'seller'] as const;
export type TaskPauseReason = (typeof TASK_PAUSE_REASONS)[number];

export interface TaskProgress {
	done: number;
	total: number;
	skipped: number;
	/** What a kind gave up on, so its next step doesn't take it again. Kept with the task, and never shown to sellers. */
	skippedHashes?: string[];
}

/** What the seller sees of a task's progress: the counts, without what a kind keeps for itself. */
export type TaskProgressView = Omit<TaskProgress, 'skippedHashes'>;

/** A seller can have at most this many queued, running or paused tasks. */
export const MAX_UNFINISHED_TASKS = 50;
/** The wait after each failure in a row, first to last. */
export const TASK_RETRY_DELAYS_MS: readonly number[] = [30_000, 120_000, 600_000, 1_800_000, 7_200_000];
/** At this many failures in a row the task is failed: after one try and a retry after each delay. */
export const TASK_MAX_FAILURES = TASK_RETRY_DELAYS_MS.length + 1;
/** How long a step holds its task before another run may take it. */
export const TASK_LEASE_MS = 120_000;

/** What a task shows the seller after a failure its kind didn't describe; a raw error is never shown. */
export const TASK_RETRY_MESSAGE = msg('Something went wrong. Estori will try again.');
export const TASK_FAILED_MESSAGE = msg("Something went wrong and Estori stopped trying. Retry when you're ready.");

/** When a task that just failed `failures` (at least 1) times in a row runs again; null once it has failed for good. */
export function taskRetryAt(failures: number, now: number): number | null {
	if (failures >= TASK_MAX_FAILURES) return null;
	return now + TASK_RETRY_DELAYS_MS[Math.min(failures, TASK_RETRY_DELAYS_MS.length) - 1];
}

/** What the seller sees of each kind's payload. */
export interface TaskViewPayloads {
	'store.translate': { locale: Locale };
}

interface TaskViewFields {
	id: string;
	appId: string | null;
	status: TaskStatus;
	progress: TaskProgressView;
	creditsUsed: number;
	pauseReason: TaskPauseReason | null;
	lastError: string | null;
	runAt: string;
	createdAt: string;
	startedAt: string | null;
	finishedAt: string | null;
}

/** A task as the seller app shows it, one member per kind; dates are ISO strings. */
export type TaskView = { [K in TaskKind]: TaskViewFields & { kind: K; payload: TaskViewPayloads[K] } }[TaskKind];
