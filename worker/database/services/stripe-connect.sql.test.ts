import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertUser, migratedD1 } from '../test-support/real-d1';
import { StripeConnectService } from './StripeConnectService';

let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	for (const id of ['u_old', 'u_synced']) await insertUser(db, id);
	await db.prepare('INSERT INTO stripe_connect_accounts (user_id, stripe_account_id) VALUES (?, ?)').bind('u_old', 'acct_old').run();
	await db.prepare('INSERT INTO stripe_connect_accounts (user_id, stripe_account_id, payout_delay_days) VALUES (?, ?, 10)').bind('u_synced', 'acct_synced').run();
});

describe('StripeConnectService.unsyncedSellerIds', () => {
	it('lists sellers whose payout delay Estori never set, such as accounts made before levels', async () => {
		expect(await new StripeConnectService(envWith(db)).unsyncedSellerIds()).toEqual(['u_old']);
	});
});
