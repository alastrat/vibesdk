import { describe, expect, it } from 'vitest';
import { defaultFlagValues } from '../../../../shared/types/feature-flags';
import { TelemetryController, adminFlagRows } from './controller';
import type { RouteContext } from '../../types/route-context';

describe('the flags admin view', () => {
	it('lists every registry flag with its value, whether PostHog answered for it, and its rollout when known', () => {
		const evaluation = { values: { ...defaultFlagValues(), billing: true, 'catalog-paused': true }, source: 'posthog' as const, inPostHog: ['billing' as const, 'catalog-paused' as const] };
		const rows = adminFlagRows(evaluation, { billing: 10, 'catalog-paused': 100 });
		expect(rows).toHaveLength(11);
		expect(rows[0]).toEqual({
			key: 'billing',
			description: 'Plans, subscriptions and the billing page. Also on with BILLING=on, or for a user in BILLING_USER_IDS.',
			kind: 'rollout',
			clientVisible: true,
			value: true,
			inPostHog: true,
			rolloutPercent: 10,
		});
		expect(rows.find((row) => row.key === 'ai-builds-paused')).toMatchObject({ kind: 'pause', clientVisible: false, value: false, inPostHog: false, rolloutPercent: 0 });
		expect(adminFlagRows(evaluation, null).every((row) => row.rolloutPercent === null)).toBe(true);
	});

	it("evaluates for the admin asking, and links to the project's flags", async () => {
		const context = { user: { id: 'admin_1' } } as unknown as RouteContext;
		const local = await TelemetryController.adminFlags(new Request('https://estori.app/api/admin/flags'), { ENVIRONMENT: 'staging' } as unknown as Env, {} as ExecutionContext, context);
		expect((await local.json()).data).toMatchObject({ userId: 'admin_1', source: 'off', posthogFlagsUrl: null });
	});
});
