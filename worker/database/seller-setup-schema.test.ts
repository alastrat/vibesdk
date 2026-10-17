import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

const migrations = import.meta.glob<string>('/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const allMigrationSql = Object.values(migrations).join('\n');

describe('seller setup schema', () => {
	it('records the selling-terms agreement on users, empty for everyone today', () => {
		const columns = getTableConfig(schema.users).columns;
		expect(columns.find((column) => column.name === 'seller_terms_version')?.notNull).toBe(false);
		expect(columns.find((column) => column.name === 'seller_terms_accepted_at')?.notNull).toBe(false);
	});

	it('stores whether the Connect account takes card payments, off until Stripe says so', () => {
		expect(schema.stripeConnectAccounts.cardPaymentsActive.default).toBe(false);
		expect(schema.stripeConnectAccounts.cardPaymentsActive.notNull).toBe(true);
	});

	it('ships the three columns in a migration', () => {
		expect(allMigrationSql).toContain('ALTER TABLE `users` ADD `seller_terms_version` text');
		expect(allMigrationSql).toContain('ALTER TABLE `users` ADD `seller_terms_accepted_at` integer');
		expect(allMigrationSql).toContain('ALTER TABLE `stripe_connect_accounts` ADD `card_payments_active` integer DEFAULT false NOT NULL');
	});
});
