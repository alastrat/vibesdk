import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/services/billing/actions.ts'], { query: '?raw', import: 'default', eager: true });
const actions = sources['/worker/services/billing/actions.ts'] ?? '';

function action(name: string): string {
	const signature = `export async function ${name}(`;
	const start = actions.indexOf(signature);
	if (start === -1) throw new Error(`Action not found: ${name}`);
	const next = actions.indexOf('\nexport ', start + signature.length);
	return actions.slice(start, next === -1 ? undefined : next);
}

const PAUSE = 'await deps.checkoutPaused(';

describe('billing while checkout is paused', () => {
	it('refuses a plan checkout and extra credits first, before Stripe or the ledger is asked', () => {
		for (const name of ['startCheckout', 'buyCredits']) {
			const body = action(name);
			expect(body, name).toContain(PAUSE);
			expect(body, name).toContain('{ ok: false, status: 503, message: BILLING_CHECKOUT_PAUSED_MESSAGE }');
			expect(body.indexOf('await '), name).toBe(body.indexOf(PAUSE));
		}
	});

	it("refuses a plan change after keeping the current plan, which only drops a scheduled move, and before any price is changed", () => {
		const body = action('changePlan');
		const pause = body.indexOf(PAUSE);
		const keepCurrent = body.indexOf('releaseSchedule(stripe, row.stripeSubscriptionId, scheduleId)');
		expect(body).toContain('{ ok: false, status: 503, message: BILLING_CHECKOUT_PAUSED_MESSAGE }');
		expect(keepCurrent).toBeGreaterThan(-1);
		expect(pause).toBeGreaterThan(keepCurrent);
		for (const call of ['scheduleSubscriptionPrice', 'changeSubscriptionPrice']) expect(body.indexOf(call), call).toBeGreaterThan(pause);
	});

	it('keeps cancelling, undoing a cancel and the billing portal open', () => {
		for (const name of ['cancelPlan', 'resumePlan', 'openPortal']) expect(action(name), name).not.toContain('checkoutPaused');
	});

	it('asks the pause flag for the signed-in seller', () => {
		expect(actions).toContain("checkoutPaused: (userId) => isFlagOn(env, 'billing-checkout-paused', userId)");
	});
});
