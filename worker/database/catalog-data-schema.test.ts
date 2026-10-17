import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

const migrations = import.meta.glob<string>('/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const allMigrationSql = Object.values(migrations).join('\n');

describe('catalog data schema', () => {
	it('keeps one row per supplier product and per supplier variant', () => {
		const products = getTableConfig(schema.catalogProducts).indexes.find((index) => index.config.name === 'catalog_products_supplier_unique_idx');
		const variants = getTableConfig(schema.catalogVariants).indexes.find((index) => index.config.name === 'catalog_variants_supplier_variant_unique_idx');
		expect(products?.config.unique).toBe(true);
		expect(variants?.config.unique).toBe(true);
	});

	it('keys offers by variant and destination', () => {
		const keys = getTableConfig(schema.catalogVariantOffers).primaryKeys[0]?.columns.map((column) => column.name);
		expect(keys).toEqual(['variant_id', 'destination_country']);
		expect(schema.catalogProducts.status.default).toBe('active');
	});

	it('ships the tables in a migration', () => {
		for (const table of ['catalog_products', 'catalog_variants', 'catalog_variant_offers']) expect(allMigrationSql).toContain(`CREATE TABLE \`${table}\``);
	});
});
