/** Task spend made visible: one `task_finished` event when a task reaches a final status. */

import type { TaskRecord } from '../../database/services/TaskService';
import type { ServerAnalytics } from '../posthog/analytics';

/**
 * Whoever moves a task to its final status sends this once, from the record that move answered: the runner for `done`
 * and `failed`, and the seller's cancel for `canceled`. Anything not final sends nothing.
 */
export function trackTaskEnded(analytics: ServerAnalytics, task: TaskRecord): void {
	if (task.status !== 'done' && task.status !== 'failed' && task.status !== 'canceled') return;
	analytics.capture('task_finished', task.userId, { kind: task.kind, status: task.status, credits_used: task.creditsUsed, steps: task.steps });
}
