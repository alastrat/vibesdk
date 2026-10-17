/** Taking a live store offline: it closes at once, and checkouts a shopper could still pay are expired at Stripe. */

import { releaseOldestHolds, type Hold } from '../store-payments/holds';

export interface TakeOfflineDeps {
	setOffline(): Promise<void>;
	openCheckouts(): Promise<readonly Hold[]>;
	expireSession(sessionId: string): Promise<void>;
	markExpired(checkoutId: string): Promise<boolean>;
}

export async function takeStoreOffline(deps: TakeOfflineDeps): Promise<void> {
	await deps.setOffline();
	await releaseOldestHolds({ holds: deps.openCheckouts, expireSession: deps.expireSession, markExpired: deps.markExpired }, Number.POSITIVE_INFINITY);
}
