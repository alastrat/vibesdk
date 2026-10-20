/** Payments readiness on real SQL: payments_ready goes once, when Stripe first makes the account ready. */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { envWith, insertUser, migratedD1 } from '../test-support/real-d1';

const captured = vi.hoisted((): Array<[string, string]> => []);
vi.mock('../../services/posthog/analytics', () => ({
	serverAnalytics: () => ({ capture: (name: string, userId: string) => captured.push([name, userId]) }),
}));

const { StripeConnectService } = await import('./StripeConnectService');

const NOT_READY = { detailsSubmitted: false, chargesEnabled: false, payoutsEnabled: false, transfersActive: false, cardPaymentsActive: false };
const READY = { detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: true, transfersActive: true, cardPaymentsActive: true };
let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'ready_1');
});

describe('payments readiness', () => {
	it('sends payments_ready once, on the update that makes the account ready', async () => {
		const accounts = new StripeConnectService(envWith(db));
		await accounts.create({ userId: 'ready_1', stripeAccountId: 'acct_ready', flags: NOT_READY });
		expect(await accounts.updateFlags('acct_ready', { ...NOT_READY, detailsSubmitted: true })).toEqual({ userId: 'ready_1', becameReady: false });
		expect(await accounts.updateFlags('acct_ready', READY)).toEqual({ userId: 'ready_1', becameReady: true });
		expect(await accounts.updateFlags('acct_ready', READY)).toEqual({ userId: 'ready_1', becameReady: false });
		expect(captured).toEqual([['payments_ready', 'ready_1']]);
	});

	it('answers null for an account Estori does not know', async () => {
		expect(await new StripeConnectService(envWith(db)).updateFlags('acct_unknown', READY)).toBeNull();
	});
});
