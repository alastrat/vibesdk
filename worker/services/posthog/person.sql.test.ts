/** Person properties on real SQL; each test's writes are rolled back after it. */
import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertApp, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { personUpdateOf } from './person';

let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'per_1');
	await insertUser(db, 'per_2');
});

describe('person properties', () => {
	it('sets the plan, the seller level and whether a store is live, and the signup date once', async () => {
		await db.prepare(`UPDATE users SET created_at = ? WHERE id = 'per_1'`).bind(Date.UTC(2026, 9, 19, 15) / 1000).run();
		await db.prepare(`INSERT INTO stripe_connect_accounts (user_id, stripe_account_id, seller_level) VALUES ('per_1', 'acct_per_1', 'established')`).run();
		await insertApp(db, { id: 'app_per', userId: 'per_1' });
		await db
			.prepare(`INSERT INTO live_stores (app_id, slug, status, published_commit, published_at, created_at, updated_at) VALUES ('app_per', 'per-store', 'live', 'c0ffee', 1, 1, 1)`)
			.run();
		expect(await personUpdateOf(envWith(db), 'per_1')).toEqual({
			set: { plan: 'basic', seller_level: 'established', has_live_store: true },
			setOnce: { signup_date: '2026-10-19' },
		});
	});

	it('reads a new account as Basic, not a seller and without a live store; an unreadable creation time sets no date', async () => {
		expect(await personUpdateOf(envWith(db), 'per_2')).toEqual({ set: { plan: 'basic', seller_level: 'none', has_live_store: false } });
	});

	it('answers nothing for an unknown user or a database that fails', async () => {
		expect(await personUpdateOf(envWith(db), 'nobody')).toEqual({});
		const broken = envWith({ prepare: () => { throw new Error('D1 down'); } } as unknown as D1Database);
		expect(await personUpdateOf(broken, 'per_1')).toEqual({});
	});
});
