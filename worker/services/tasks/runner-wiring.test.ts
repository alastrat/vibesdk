import { beforeAll, describe, expect, it, vi } from 'vitest';
import { envWith, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { TaskService } from '../../database/services/TaskService';
import { runTaskSchedule, TASK_SWEEP_CRON, wakeTaskRunner } from './scheduler';

const CONFIGS = ['/wrangler.jsonc', '/wrangler.estori.jsonc', '/wrangler.estori-staging.jsonc'];

const sources = import.meta.glob<string>(['/worker/index.ts', '/wrangler.jsonc', '/wrangler.estori.jsonc', '/wrangler.estori-staging.jsonc', '/worker/services/tasks/TaskRunner.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

function fakeRunners(options: { failing?: boolean } = {}) {
	const woken: Array<{ name: string; userId: string }> = [];
	const namespace = {
		idFromName: (name: string) => name,
		get: (name: string) => ({
			wake: async (userId: string) => {
				if (options.failing) throw new Error('Durable Object reset');
				woken.push({ name, userId });
			},
		}),
	};
	return { runners: namespace as unknown as Env['TASK_RUNNER'], woken };
}

let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'seller_due');
	await insertUser(db, 'seller_later');
});

describe('the task runner wiring', () => {
	it('exports the runner and binds it in all three configs with migration v8', () => {
		expect(source('/worker/index.ts')).toContain("export { TaskRunner } from './services/tasks/TaskRunner';");
		for (const config of CONFIGS) {
			const text = source(config);
			expect(text, config).toContain('"class_name": "TaskRunner"');
			expect(text, config).toContain('"name": "TASK_RUNNER"');
			expect(text, config).toMatch(/"new_sqlite_classes": \[\s*"TaskRunner"\s*\],\s*"tag": "v8"/);
		}
	});

	it('sweeps from the scheduled handler, inside the request scope, on a cron every config runs', () => {
		const index = source('/worker/index.ts');
		const scheduled = index.slice(index.indexOf('async scheduled('));
		expect(scheduled.indexOf('ctx.waitUntil(runTaskSchedule(controller.cron, env));')).toBeGreaterThan(scheduled.indexOf('runInRequestScope(ctx, '));
		expect(TASK_SWEEP_CRON).toBe('*/15 * * * *');
		for (const config of CONFIGS) expect(source(config), config).toMatch(/"crons": \[[^\]]*"\*\/15 \* \* \* \*"/);
	});

	it('keeps the seller under "userId", runs one tick per alarm, and re-arms a minute later when the alarm throws', () => {
		const runner = source('/worker/services/tasks/TaskRunner.ts');
		expect(runner).toContain("const USER_KEY = 'userId';");
		expect(runner).toContain('const ALARM_RETRY_MS = 60 * 1000;');
		const alarm = runner.slice(runner.indexOf('async alarm()'));
		expect(alarm).toContain('runTaskTick(');
		expect(alarm).toContain('meter: taskMeterFromEnv(this.env)');
		expect(alarm.indexOf('setAlarm(Date.now() + ALARM_RETRY_MS)')).toBeGreaterThan(alarm.indexOf('catch (error)'));
	});

	it('wakes the runner named after the seller, and never throws', async () => {
		const { runners, woken } = fakeRunners();
		await wakeTaskRunner({ TASK_RUNNER: runners } as unknown as Env, 'seller_1');
		expect(woken).toEqual([{ name: 'seller_1', userId: 'seller_1' }]);

		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(wakeTaskRunner({ TASK_RUNNER: fakeRunners({ failing: true }).runners } as unknown as Env, 'seller_1')).resolves.toBeUndefined();
		expect(errorLog).toHaveBeenCalledTimes(1);
		errorLog.mockRestore();
	});

	it('the sweep wakes sellers with due work, on the 15-minute cron only', async () => {
		const tasks = new TaskService(envWith(db));
		await tasks.enqueue({ userId: 'seller_due', appId: null, kind: 'store.translate', payload: {}, dedupeKey: 'due', runAt: Date.now() - 60_000 });
		await tasks.enqueue({ userId: 'seller_later', appId: null, kind: 'store.translate', payload: {}, dedupeKey: 'later', runAt: Date.now() + 60 * 60 * 1000 });
		const { runners, woken } = fakeRunners();
		const env = envWith(db, { TASK_RUNNER: runners });

		const infoLog = vi.spyOn(console, 'log').mockImplementation(() => {});
		await runTaskSchedule('5 * * * *', env);
		expect(woken).toEqual([]);
		await runTaskSchedule(TASK_SWEEP_CRON, env);
		expect(woken).toEqual([{ name: 'seller_due', userId: 'seller_due' }]);
		expect(infoLog.mock.calls.map((call) => String(call[0])).join('\n')).toContain('Woke task runners with due work');
		infoLog.mockRestore();
	});
});
