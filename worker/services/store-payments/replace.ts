/**
 * Replacing a checkout after a cart edit or a reload. Its Stripe session is expired first: only once Stripe can no
 * longer take a payment on it does it stop counting toward the seller's weekly cap.
 */

export interface ReplaceDeps {
	/** This store's checkout while it's starting or open, with its Stripe session once it has one; null otherwise. */
	openSession(checkoutId: string): Promise<{ sessionId: string | null } | null>;
	expireSession(sessionId: string): Promise<void>;
	markReplaced(checkoutId: string): Promise<void>;
}

export async function replaceCheckout(deps: ReplaceDeps, checkoutId: string): Promise<void> {
	const open = await deps.openSession(checkoutId);
	if (!open) return;
	if (open.sessionId) {
		try {
			await deps.expireSession(open.sessionId);
		} catch {
			// Still payable at Stripe, so it stays open and counted; the cap can release it later.
			return;
		}
	}
	await deps.markReplaced(checkoutId);
}
