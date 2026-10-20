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
	it('refuses a plan checkout, a plan change and extra credits first, before Stripe or the ledger is asked', () => {
		for (const name of ['startCheckout', 'changePlan', 'buyCredits']) {
			const body = action(name);
			expect(body, name).toContain(PAUSE);
			expect(body, name).toContain('{ ok: false, status: 503, message: BILLING_CHECKOUT_PAUSED_MESSAGE }');
			expect(body.indexOf('await '), name).toBe(body.indexOf(PAUSE));
		}
	});

	it('keeps cancelling, undoing a cancel and the billing portal open', () => {
		for (const name of ['cancelPlan', 'resumePlan', 'openPortal']) expect(action(name), name).not.toContain('checkoutPaused');
	});

	it('asks the pause flag for the signed-in seller', () => {
		expect(actions).toContain("checkoutPaused: (userId) => isFlagOn(env, 'billing-checkout-paused', userId)");
	});
});
