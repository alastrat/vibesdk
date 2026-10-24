import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import {
	keysetCursorOf,
	parseKeysetCursor,
} from '../worker/database/services/keyset-cursor';
import {
	seedSampleTransactions,
	assertLocalSamplePath,
	SAMPLE_OWNER_ID,
	SAMPLE_STORE_IDS,
} from './seed-local-store-transactions';

function database() {
	const db = new Database(':memory:');
	db.exec(
		'PRAGMA foreign_keys=ON; CREATE TABLE apps (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL);',
	);
	const migration = readFileSync(
		new URL('../migrations/0018_store_payments.sql', import.meta.url),
		'utf8',
	);
	for (const table of ['store_orders', 'store_order_items']) {
		const ddl = migration.match(
			new RegExp('CREATE TABLE `' + table + '`[\\s\\S]*?;'),
		)?.[0];
		if (!ddl) throw new Error('Missing real schema: ' + table);
		db.exec(ddl);
	}
	db.exec(
		'ALTER TABLE store_orders ADD COLUMN shipped_at integer; CREATE UNIQUE INDEX sample_order_numbers ON store_orders(app_id, mode, order_number);',
	);
	for (const [i, id] of SAMPLE_STORE_IDS.entries())
		db.query('INSERT INTO apps VALUES (?, ?, ?)').run(
			id,
			SAMPLE_OWNER_ID,
			`Sample store ${i}`,
		);
	return db;
}
describe('local sample transaction seeder', () => {
	it('seeds varied test history and lines idempotently without Stripe identifiers', () => {
		const db = database();
		try {
			const first = seedSampleTransactions(db, {
				asOf: '2026-10-24',
				days: 180,
			});
			const second = seedSampleTransactions(db, {
				asOf: '2026-10-24',
				days: 180,
			});
			expect(second).toEqual(first);
			expect(first.orders).toBeGreaterThan(300);
			expect(
				db.query('SELECT COUNT(*) AS count FROM store_orders').get(),
			).toEqual({ count: first.orders });
			expect(
				db
					.query(
						"SELECT COUNT(*) AS count FROM store_orders WHERE mode != 'test' OR stripe_payment_intent_id IS NOT NULL OR stripe_checkout_session_id IS NOT NULL OR seller_stripe_account_id IS NOT NULL OR customer_email NOT LIKE '%@example.test' OR note NOT LIKE 'SAMPLE DATA%'",
					)
					.get(),
			).toEqual({ count: 0 });
			expect(
				db
					.query(
						'SELECT COUNT(DISTINCT payment_status) AS statuses, COUNT(DISTINCT fulfillment_status) AS fulfillment FROM store_orders',
					)
					.get(),
			).toEqual({ statuses: 5, fulfillment: 2 });
			expect(
				db
					.query('SELECT COUNT(*) AS count FROM store_order_items')
					.get(),
			).toEqual({ count: first.items });
			expect(
				db
					.query(
						'SELECT (MAX(created_at)-MIN(created_at))/86400 AS span FROM store_orders',
					)
					.get(),
			).toMatchObject({ span: 179 });
		} finally {
			db.close();
		}
	});
	it('produces IDs accepted by the real chronological pagination cursor', () => {
		const db = database();
		try {
			seedSampleTransactions(db, { asOf: '2026-10-24' });
			const rows = db
				.query<
					{ id: string; created_at: number },
					[]
				>('SELECT id,created_at FROM store_orders ORDER BY created_at DESC,id DESC')
				.all();
			for (const row of rows) {
				const createdAt = new Date(row.created_at * 1000);
				expect(
					parseKeysetCursor(keysetCursorOf(createdAt, row.id)),
				).toEqual({ createdAt, id: row.id });
			}
		} finally {
			db.close();
		}
	});
	it('supports a dry run and preserves unrelated orders when reseeding', () => {
		const db = database();
		try {
			const planned = seedSampleTransactions(db, {
				asOf: '2026-10-24',
				dryRun: true,
			});
			expect(
				db.query('SELECT COUNT(*) AS count FROM store_orders').get(),
			).toEqual({ count: 0 });
			seedSampleTransactions(db, { asOf: '2026-10-24' });
			db.exec(
				"INSERT INTO store_orders (id,mode,app_id,order_number,checkout_id,seller_user_id,subtotal_cents,shipping_cents,total_cents,application_fee_cents,created_at,updated_at) VALUES ('unrelated-live','live','unrelated-store',1,'unrelated-checkout','other-owner',1000,0,1000,30,1,1)",
			);
			seedSampleTransactions(db, { asOf: '2026-10-24' });
			expect(
				db.query('SELECT COUNT(*) AS count FROM store_orders').get(),
			).toEqual({ count: planned.orders + 1 });
			expect(
				db
					.query(
						"SELECT mode,seller_user_id FROM store_orders WHERE id='unrelated-live'",
					)
					.get(),
			).toEqual({ mode: 'live', seller_user_id: 'other-owner' });
		} finally {
			db.close();
		}
	});
	it('refuses a remote CLI flag before opening a database', () => {
		const result = Bun.spawnSync([
			process.execPath,
			new URL('./seed-local-store-transactions.ts', import.meta.url)
				.pathname,
			'--remote',
		]);
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain(
			'only writes local sample data',
		);
	});
	it('refuses an ownership mismatch before writing either store', () => {
		const db = database();
		try {
			db.query('UPDATE apps SET user_id=? WHERE id=?').run(
				'different-owner',
				SAMPLE_STORE_IDS[1],
			);
			expect(() =>
				seedSampleTransactions(db, { asOf: '2026-10-24' }),
			).toThrow('ownership');
			expect(
				db.query('SELECT COUNT(*) AS count FROM store_orders').get(),
			).toEqual({ count: 0 });
		} finally {
			db.close();
		}
	});
	it('refuses an existing conflicting order rather than overwriting it', () => {
		const db = database();
		try {
			seedSampleTransactions(db, { asOf: '2026-10-24' });
			db.exec(
				"UPDATE store_orders SET mode='live' WHERE rowid=(SELECT MIN(rowid) FROM store_orders)",
			);
			expect(() =>
				seedSampleTransactions(db, { asOf: '2026-10-24' }),
			).toThrow('conflict');
			expect(
				db
					.query(
						"SELECT COUNT(*) AS count FROM store_orders WHERE mode='live'",
					)
					.get(),
			).toEqual({ count: 1 });
		} finally {
			db.close();
		}
	});
	it('rejects paths outside the repository local Wrangler D1 directory', () => {
		expect(() =>
			assertLocalSamplePath('/tmp/production.sqlite', process.cwd()),
		).toThrow('local Wrangler');
	});
});
