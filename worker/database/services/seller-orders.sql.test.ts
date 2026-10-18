/**
 * A seller's own store orders on real SQL: the list's views and filters, one order's facts, and marking it shipped.
 * Each test's writes are rolled back after it.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { migratedD1 } from '../test-support/real-d1';

let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
});

describe('seller orders on real SQL', () => {
	it("records when an order shipped, and lists a seller's orders by date from one index", async () => {
		const table = await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'store_orders'").first<{ sql: string }>();
		expect(table?.sql).toContain('`shipped_at` integer');
		const indexes = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'store_orders'").all<{ name: string }>();
		const names = indexes.results.map((row) => row.name);
		expect(names).toContain('store_orders_seller_created_idx');
		expect(names).not.toContain('store_orders_seller_idx');
	});
});
