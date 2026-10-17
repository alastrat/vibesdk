import { describe, expect, it } from 'vitest';
import { replaceCheckout, type ReplaceDeps } from './replace';

function world(options: { open?: { sessionId: string | null } | null; stripeFails?: boolean } = {}) {
	const steps: string[] = [];
	const deps: ReplaceDeps = {
		openSession: async (checkoutId) => (steps.push(`read ${checkoutId}`), options.open === undefined ? { sessionId: 'cs_old' } : options.open),
		expireSession: async (sessionId) => {
			if (options.stripeFails) throw new Error('Stripe is unreachable');
			steps.push(`expire ${sessionId}`);
		},
		markReplaced: async (checkoutId) => {
			steps.push(`replaced ${checkoutId}`);
		},
	};
	return { deps, steps };
}

describe('replacing a checkout after a cart edit', () => {
	it('expires its Stripe session first, then marks it replaced', async () => {
		const { deps, steps } = world();
		await replaceCheckout(deps, 'chk_old');
		expect(steps).toEqual(['read chk_old', 'expire cs_old', 'replaced chk_old']);
	});

	it("leaves it open, still counting toward the cap, when Stripe can't expire its session", async () => {
		const { deps, steps } = world({ stripeFails: true });
		await replaceCheckout(deps, 'chk_old');
		expect(steps).toEqual(['read chk_old']);
	});

	it('marks a checkout still starting, with no session yet, without asking Stripe', async () => {
		const { deps, steps } = world({ open: { sessionId: null } });
		await replaceCheckout(deps, 'chk_new');
		expect(steps).toEqual(['read chk_new', 'replaced chk_new']);
	});

	it('does nothing for a checkout that is no longer open', async () => {
		const { deps, steps } = world({ open: null });
		await replaceCheckout(deps, 'chk_paid');
		expect(steps).toEqual(['read chk_paid']);
	});
});
