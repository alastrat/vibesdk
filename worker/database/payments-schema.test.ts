import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';
import { TemplateService } from './services/TemplateService';

const migrations = import.meta.glob<string>('/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const allMigrationSql = Object.values(migrations).join('\n');

/** A D1 stand-in that records each statement the service prepares and returns no rows. */
function recordingD1() {
	const statements: { sql: string; params: unknown[] }[] = [];
	const d1 = {
		batch: async () => [],
		exec: async () => ({ count: 0, duration: 0 }),
		prepare(sql: string) {
			const entry = { sql, params: [] as unknown[] };
			statements.push(entry);
			const statement = {
				bind(...params: unknown[]) {
					entry.params = params;
					return statement;
				},
				all: async () => ({ results: [], success: true, meta: {} }),
				raw: async () => [],
				run: async () => ({ results: [], success: true, meta: {} }),
				first: async () => null,
			};
			return statement;
		},
	};
	return { d1, statements };
}

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

	it('lists every Stripe sale, including those of deleted sites', async () => {
		const { d1, statements } = recordingD1();
		await new TemplateService({ DB: d1 } as unknown as Env).listRecentSales(25);

		const sql = statements[0].sql.toLowerCase();
		// The listing row is gone once its app is deleted, so the sale must not depend on it.
		expect(sql).not.toMatch(/join "templates"/);
		expect(sql).toMatch(/left join "apps" on "apps"\."id" = "template_purchases"\."source_app_id"/);
		expect(sql).toMatch(/left join "users"/);
		expect(statements[0].params).toEqual(['stripe', 25]);
	});
});
