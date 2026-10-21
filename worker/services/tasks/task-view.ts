/** A task as the seller app shows it: ISO dates, and only the part of its payload the seller needs. */

import { isLocale } from '../../../shared/i18n/locales';
import type { TaskView } from '../../../shared/types/tasks';
import type { TaskRecord } from '../../database/services/TaskService';

const iso = (at: number): string => new Date(at).toISOString();
const isoOrNull = (at: number | null): string | null => (at === null ? null : iso(at));

function field(payload: unknown, key: string): unknown {
	return typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>)[key] : undefined;
}

/** Null when the payload doesn't fit its kind, which the runner fails anyway. */
export function taskView(task: TaskRecord): TaskView | null {
	const fields = {
		id: task.id,
		appId: task.appId,
		status: task.status,
		progress: { done: task.progress.done, total: task.progress.total, skipped: task.progress.skipped },
		creditsUsed: task.creditsUsed,
		pauseReason: task.pauseReason,
		lastError: task.lastError,
		runAt: iso(task.runAt),
		createdAt: iso(task.createdAt),
		startedAt: isoOrNull(task.startedAt),
		finishedAt: isoOrNull(task.finishedAt),
	};
	switch (task.kind) {
		case 'store.translate': {
			const locale = field(task.payload, 'locale');
			return isLocale(locale) ? { ...fields, kind: task.kind, payload: { locale } } : null;
		}
	}
}
