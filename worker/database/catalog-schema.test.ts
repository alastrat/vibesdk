import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

const migrations = import.meta.glob<string>('/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const allMigrationSql = Object.values(migrations).join('\n');

function indexNamed(table: Parameters<typeof getTableConfig>[0], name: string) {
	return getTableConfig(table).indexes.find((index) => index.config.name === name);
}

describe('catalog order schema', () => {
	it('records each paid Checkout session as at most one catalog order', () => {
		expect(indexNamed(schema.catalogOrders, 'catalog_orders_checkout_session_unique_idx')?.config.unique).toBe(true);
		expect(schema.catalogOrders.stripeCheckoutSessionId.notNull).toBe(true);
	});

	it('starts orders awaiting placement and items pending, in dollars', () => {
		expect(schema.catalogOrders.status.default).toBe('awaiting-placement');
		expect(schema.catalogOrders.status.enumValues).toEqual(['awaiting-placement', 'placement-done', 'needs-attention']);
		expect(schema.catalogOrders.currency.default).toBe('usd');
		expect(schema.catalogOrderItems.status.default).toBe('pending');
		expect(schema.catalogOrderItems.supplier.enumValues).toEqual(['cjdropshipping']);
		expect(schema.catalogOrderItems.supplierRefunded.default).toBe(false);
	});

	it('ships both tables and the unique session index in a migration', () => {
		expect(allMigrationSql).toContain('CREATE TABLE `catalog_orders`');
		expect(allMigrationSql).toContain('CREATE TABLE `catalog_order_items`');
		expect(allMigrationSql).toContain('CREATE UNIQUE INDEX `catalog_orders_checkout_session_unique_idx`');
	});
});
