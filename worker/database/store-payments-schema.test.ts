import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

const migrations = import.meta.glob<string>('/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const allMigrationSql = Object.values(migrations).join('\n');

function indexNamed(table: Parameters<typeof getTableConfig>[0], name: string) {
	return getTableConfig(table).indexes.find((index) => index.config.name === name);
}

describe('store payments schema', () => {
	it('records each checkout as at most one order, numbered per store and mode', () => {
		expect(indexNamed(schema.storeOrders, 'store_orders_checkout_unique_idx')?.config.unique).toBe(true);
		expect(indexNamed(schema.storeOrders, 'store_orders_session_unique_idx')?.config.unique).toBe(true);
		expect(indexNamed(schema.storeOrders, 'store_orders_number_unique_idx')?.config.unique).toBe(true);
		expect(indexNamed(schema.storeCheckouts, 'store_checkouts_session_unique_idx')?.config.unique).toBe(true);
	});

	it('starts checkouts creating and orders paid and unfulfilled', () => {
		expect(schema.storeCheckouts.status.default).toBe('creating');
		expect(schema.storeCheckouts.status.enumValues).toEqual(['creating', 'open', 'completed', 'expired', 'failed']);
		expect(schema.storeOrders.paymentStatus.default).toBe('paid');
		expect(schema.storeOrders.fulfillmentStatus.default).toBe('unfulfilled');
		expect(schema.storeOrders.refundedCents.default).toBe(0);
		expect(schema.storeOrderItems.kind.enumValues).toEqual(['own', 'catalog']);
	});

	it('ships the three tables in a migration', () => {
		expect(allMigrationSql).toContain('CREATE TABLE `store_checkouts`');
		expect(allMigrationSql).toContain('CREATE TABLE `store_orders`');
		expect(allMigrationSql).toContain('CREATE TABLE `store_order_items`');
		expect(allMigrationSql).toContain('CREATE UNIQUE INDEX `store_orders_number_unique_idx`');
	});
});
