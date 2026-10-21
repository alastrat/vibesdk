import { describe, expect, it } from 'vitest';
import type { TaskRecord } from '../../database/services/TaskService';
import { taskView } from './task-view';

const NOW = 1_800_000_000_000;

const record: TaskRecord = {
	id: 'task_1',
	userId: 'seller_1',
	appId: 'app_1',
	kind: 'store.translate',
	status: 'running',
	payload: { appId: 'app_1', locale: 'pt-BR' },
	progress: { done: 40, total: 120, skipped: 2 },
	creditsUsed: 18,
	attempts: 1,
	steps: 3,
	lastError: 'Timed out',
	pauseReason: null,
	runAt: NOW,
	leaseUntil: NOW + 120_000,
	dedupeKey: 'store.translate:app_1:pt-BR',
	createdAt: NOW - 60_000,
	startedAt: NOW - 30_000,
	finishedAt: null,
};

describe('taskView', () => {
	it("shows a task with ISO dates and its kind's payload, leaving out what only the runner uses", () => {
		expect(taskView(record)).toEqual({
			id: 'task_1',
			appId: 'app_1',
			kind: 'store.translate',
			status: 'running',
			payload: { locale: 'pt-BR' },
			progress: { done: 40, total: 120, skipped: 2 },
			creditsUsed: 18,
			pauseReason: null,
			lastError: 'Timed out',
			runAt: new Date(NOW).toISOString(),
			createdAt: new Date(NOW - 60_000).toISOString(),
			startedAt: new Date(NOW - 30_000).toISOString(),
			finishedAt: null,
		});
	});

	it('never shows the work a kind gave up on', () => {
		const view = taskView({ ...record, progress: { done: 40, total: 120, skipped: 2, skippedHashes: ['hash-a', 'hash-b'] } });
		expect(view?.progress).toEqual({ done: 40, total: 120, skipped: 2 });
	});

	it('shows nothing for a task whose payload its kind cannot read', () => {
		expect(taskView({ ...record, payload: { appId: 'app_1', locale: 'fr' } })).toBeNull();
		expect(taskView({ ...record, payload: null })).toBeNull();
	});
});
