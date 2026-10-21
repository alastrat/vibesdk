import { describe, expect, it } from 'vitest';
import { planLimitResponse } from './responses';

describe('planLimitResponse', () => {
	it('answers 402 with the refusal under error, where the frontend looks for it', async () => {
		const refusal = { code: 'plan_limit' as const, limit: 'liveStores' as const, plan: 'basic' as const, upgradeTo: 'pro' as const, message: 'Basic includes 1 live store. Get Pro for up to 3, or Premium for up to 10.' };
		const response = planLimitResponse(refusal);
		expect(response.status).toBe(402);
		expect(await response.json()).toEqual({ success: false, error: { message: refusal.message, name: 'PlanLimit', code: 'plan_limit', planLimit: refusal }, message: refusal.message });
	});
});
