import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

const migrations = import.meta.glob<string>('/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const allMigrationSql = Object.values(migrations).join('\n');

function indexNamed(table: Parameters<typeof getTableConfig>[0], name: string) {
	return getTableConfig(table).indexes.find((index) => index.config.name === name);
}

describe('payments schema', () => {
	it('stores one Stripe account per seller', () => {
		expect(schema.stripeConnectAccounts.userId.primary).toBe(true);
		expect(schema.stripeConnectAccounts.stripeAccountId.isUnique).toBe(true);
		expect(schema.stripeConnectAccounts.transfersActive.default).toBe(false);
	});

	it('records each Checkout session at most once', () => {
		expect(indexNamed(schema.templatePurchases, 'template_purchases_checkout_session_unique_idx')?.config.unique).toBe(true);
		expect(schema.templatePurchases.provider.enumValues).toEqual(['test', 'stripe']);
		expect(schema.templatePurchases.currency.default).toBe('usd');
		expect(schema.templatePurchases.platformFeeCents.notNull).toBe(false);
	});

	it('records what each purchase bought, even after its listing is deleted', () => {
		expect(schema.templatePurchases.sourceAppId.notNull).toBe(false);
		expect(schema.templatePurchases.versionId.notNull).toBe(false);
	});

	it('allows at most one version in review per listing', () => {
		expect(indexNamed(schema.templateVersions, 'template_versions_one_pending_idx')?.config.unique).toBe(true);
		expect(allMigrationSql).toMatch(/CREATE UNIQUE INDEX `template_versions_one_pending_idx`[^;]*WHERE/);
	});

	it('ships the table and columns in a migration', () => {
		expect(allMigrationSql).toContain('CREATE TABLE `stripe_connect_accounts`');
		expect(allMigrationSql).toContain('ALTER TABLE `template_purchases` ADD `stripe_checkout_session_id` text');
		expect(allMigrationSql).toContain('ALTER TABLE `template_purchases` ADD `platform_fee_cents` integer');
		expect(allMigrationSql).toContain('CREATE UNIQUE INDEX `template_purchases_checkout_session_unique_idx`');
	});
});
