/** Waking sellers' task runners: when work is queued or resumed, and from the 15-minute sweep so a lost alarm loses nothing. */

import { TaskService } from '../../database';
import { createLogger } from '../../logger';
import { CATALOG_REFRESH_CRON } from '../catalog/scheduler';

const logger = createLogger('TaskSchedule');

export const TASK_SWEEP_CRON = CATALOG_REFRESH_CRON;
/** Runners woken per sweep; the rest wait for the next one. */
const DUE_SELLERS_PER_SWEEP = 100;

/** Runs the seller's runner now. A failure is logged, not thrown: the sweep wakes it later. */
export async function wakeTaskRunner(env: Env, userId: string): Promise<void> {
	try {
		const namespace = env.TASK_RUNNER;
		await namespace.get(namespace.idFromName(userId)).wake(userId);
	} catch (error) {
		logger.error('Could not wake the task runner', { userId, error });
	}
}

export async function runTaskSchedule(cron: string, env: Env): Promise<void> {
	if (cron !== TASK_SWEEP_CRON) return;
	try {
		const userIds = await new TaskService(env).dueUserIds(Date.now(), DUE_SELLERS_PER_SWEEP);
		await Promise.all(userIds.map((userId) => wakeTaskRunner(env, userId)));
		if (userIds.length > 0) logger.info('Woke task runners with due work', { woken: userIds.length });
	} catch (error) {
		logger.error('Task sweep failed', { error });
	}
}
