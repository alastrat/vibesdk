import { describe, expect, it } from 'vitest';

/** Billing's checks read the billing flag, which keeps BILLING and BILLING_USER_IDS and adds PostHog's targeting. */
const worker = import.meta.glob<string>(['/worker/**/*.ts', '!/worker/**/*.test.ts'], { query: '?raw', import: 'default', eager: true });

/** The billing switch itself, and the flag that ORs it in. */
const SWITCH_READERS = ['/worker/services/billing/flag.ts', '/worker/services/posthog/flags.ts'];

/**
 * The switches' named accounts: the switch itself, and the renewal emails, which narrow their query to those accounts
 * only while the switches are the whole flag, and still check each account's flag.
 */
const AUDIENCE_READERS = ['/worker/services/billing/flag.ts', '/worker/services/billing/jobs.ts'];

/** Billing's checks by role. */
const BILLING_CHECKS = [
	'/worker/services/billing/account.ts', // the account loader
	'/worker/services/billing/metering.ts', // the prompt gate and older AI calls' charges
	'/worker/api/controllers/billing/controller.ts', // the billing controller
	'/worker/api/controllers/limits/controller.ts', // the limits controller's public plan and usage
];

function readersOf(call: string): string[] {
	return Object.entries(worker)
		.filter(([, text]) => text.includes(call))
		.map(([path]) => path)
		.sort();
}

describe("billing's flag checks", () => {
	it('read the billing flag', () => {
		for (const path of BILLING_CHECKS) expect(worker[path], path).toContain("isFlagOn(env, 'billing', ");
	});

	it("never read billing's env switches directly anywhere else in the Worker", () => {
		expect(readersOf('isBillingOn(')).toEqual([...SWITCH_READERS].sort());
		expect(readersOf('billingAudience(')).toEqual([...AUDIENCE_READERS].sort());
	});

	it("send renewal emails by each account's billing flag, using the switches' list only while it is the whole flag", () => {
		const jobs = worker['/worker/services/billing/jobs.ts'] ?? '';
		expect(jobs).toContain('if (posthogConfig(env) || flagOverridesOf(env).billing) return null;');
		expect(jobs).toContain("if (!account.billing || account.source === 'subscription' || account.period.startMs !== dayStartMs) continue;");
	});
});
