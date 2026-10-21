import { describe, expect, it } from 'vitest';
import type { ServerEventName, ServerEventProperties } from '../../../shared/types/analytics-events';
import type { TaskRecord } from '../../database/services/TaskService';
import type { ServerAnalytics } from '../posthog/analytics';
import { trackTaskEnded } from './task-events';

function recorder() {
	const sent: Array<{ name: ServerEventName; userId: string; properties: unknown }> = [];
	const analytics: ServerAnalytics = {
		capture<N extends ServerEventName>(name: N, userId: string, properties: ServerEventProperties<N>) {
			sent.push({ name, userId, properties });
		},
	};
	return { analytics, sent };
}

function task(status: TaskRecord['status']): TaskRecord {
	return {
		id: 'task_1',
		userId: 'seller_1',
		appId: 'app_1',
		kind: 'store.translate',
		status,
		payload: { appId: 'app_1', locale: 'es' },
		progress: { done: 80, total: 80, skipped: 0 },
		creditsUsed: 37,
		attempts: 0,
		steps: 3,
		lastError: null,
		pauseReason: null,
		runAt: 0,
		leaseUntil: null,
		dedupeKey: 'store.translate:app_1:es',
		createdAt: 0,
		startedAt: 0,
		finishedAt: 1,
	};
}

describe('trackTaskEnded', () => {
	it.each(['done', 'failed', 'canceled'] as const)('sends one task_finished for the seller when a task is %s, with its steps and credits', (status) => {
		const { analytics, sent } = recorder();
		trackTaskEnded(analytics, task(status));
		expect(sent).toEqual([{ name: 'task_finished', userId: 'seller_1', properties: { kind: 'store.translate', status, credits_used: 37, steps: 3 } }]);
	});

	it('sends nothing for a task that has not ended', () => {
		const { analytics, sent } = recorder();
		for (const status of ['queued', 'running', 'paused'] as const) trackTaskEnded(analytics, task(status));
		expect(sent).toEqual([]);
	});
});
