/**
 * Unpaid checkouts hold room under the seller's weekly cap while a shopper may still pay. When a new checkout needs that
 * room, the oldest are released, so checkouts nobody pays for can't pause a store; only paid sales can.
 */

export interface Hold {
	id: string;
	sessionId: string;
	weightedCents: number;
}

export interface HoldDeps {
	/** The seller's open checkouts in this mode this week, oldest first. */
	holds(): Promise<readonly Hold[]>;
	expireSession(sessionId: string): Promise<void>;
	/** False when the checkout is no longer open: it was paid or expired in the meantime. */
	markExpired(checkoutId: string): Promise<boolean>;
}

/** Releases the oldest holds until `cents` of the cap are free, and answers how much it freed. */
export async function releaseOldestHolds(deps: HoldDeps, cents: number): Promise<number> {
	let freed = 0;
	if (cents <= 0) return freed;
	for (const hold of await deps.holds()) {
		if (freed >= cents) break;
		try {
			await deps.expireSession(hold.sessionId);
		} catch {
			// Stripe couldn't be reached: the rest stay held rather than risk a session that can still be paid.
			break;
		}
		if (await deps.markExpired(hold.id)) freed += hold.weightedCents;
	}
	return freed;
}
