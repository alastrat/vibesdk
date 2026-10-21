import { describe, expect, it } from 'vitest';
import { recordingD1 } from '../../database/test-support/recording-d1';
import { CATALOG_HEALTH_CRON } from '../catalog/health';
import { CATALOG_REFRESH_CRON, CATALOG_SWEEP_CRON } from '../catalog/scheduler';
import { runBillingSchedule } from './wiring';

const sources = import.meta.glob<string>(['/worker/index.ts', '/worker/api/controllers/payments/webhook.ts'], { query: '?raw', import: 'default', eager: true });

describe('billing schedule wiring', () => {
	it('runs the daily jobs on the daily schedule and the renewal emails hourly, and nothing on the others', async () => {
		const { d1, statements } = recordingD1();
		const env = { DB: d1, BILLING: 'on', ENVIRONMENT: 'dev' } as unknown as Env;
		await runBillingSchedule(CATALOG_REFRESH_CRON, env);
		expect(statements).toEqual([]);
		await runBillingSchedule(CATALOG_HEALTH_CRON, env);
		expect(statements.some((entry) => entry.sql.includes('"subscriptions"'))).toBe(true);
		expect(statements.some((entry) => entry.sql.includes('"credit_periods"'))).toBe(true);
		statements.length = 0;
		await runBillingSchedule(CATALOG_SWEEP_CRON, env);
		expect(statements.some((entry) => entry.sql.includes('users') && entry.sql.includes('billing_notices'))).toBe(true);
	});

	it('is called from the scheduled handler, and the webhook offers billing each platform event first', () => {
		expect(sources['/worker/index.ts']).toContain('ctx.waitUntil(runBillingSchedule(controller.cron, env));');
		const webhook = sources['/worker/api/controllers/payments/webhook.ts'] ?? '';
		const dispatch = webhook.slice(webhook.indexOf('async function dispatchStripeEvent('));
		expect(dispatch.indexOf('handleBillingEvent(')).toBeGreaterThan(dispatch.indexOf('CONNECT_EVENT_TYPES.includes(event.type)'));
		expect(dispatch.indexOf('handleBillingEvent(')).toBeLessThan(dispatch.indexOf('fulfillCheckoutSession('));
	});
});
