/**
 * One Durable Object per seller, named after them: it runs the seller's tasks one step per alarm, so credits are spent
 * in order and one seller's large job never holds up another's. RPC methods only store state and set the alarm.
 */

import { DurableObject } from 'cloudflare:workers';
import { createLogger } from '../../logger';
import { serverAnalytics } from '../posthog/analytics';
import { TaskService } from '../../database';
import type { TaskRecord } from '../../database/services/TaskService';
import { taskKind } from './kinds';
import { runTaskTick } from './runner';
import { trackTaskEnded } from './task-events';
import { taskMeterFromEnv } from './task-meter';

const logger = createLogger('TaskRunner');
const USER_KEY = 'userId';
const ALARM_RETRY_MS = 60 * 1000;

export class TaskRunner extends DurableObject<Env> {
	/** Work was queued or resumed: run now. */
	async wake(userId: string): Promise<void> {
		await this.ctx.storage.put(USER_KEY, userId);
		await this.ctx.storage.setAlarm(Date.now());
	}

	/** A failed alarm tries again later: every step is safe to repeat, and a held lease runs out on its own. */
	async alarm(): Promise<void> {
		const userId = await this.ctx.storage.get<string>(USER_KEY);
		if (!userId) return;
		try {
			const analytics = serverAnalytics(this.env);
			const deps = { store: new TaskService(this.env), meter: taskMeterFromEnv(this.env), kinds: taskKind, env: this.env, ended: (task: TaskRecord) => trackTaskEnded(analytics, task) };
			const { nextAlarmAt } = await runTaskTick(deps, userId, Date.now());
			if (nextAlarmAt !== null) await this.ctx.storage.setAlarm(nextAlarmAt);
		} catch (error) {
			logger.error('Task runner alarm failed; trying again later', { userId, error });
			await this.ctx.storage.setAlarm(Date.now() + ALARM_RETRY_MS);
		}
	}
}
