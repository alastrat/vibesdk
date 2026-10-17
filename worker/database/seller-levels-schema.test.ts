import { describe, expect, it } from 'vitest';
import * as schema from './schema';
import { CATALOG_ORDER_STATUSES } from '../../shared/types/catalog';

const migrations = import.meta.glob<string>('/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const allMigrationSql = Object.values(migrations).join('\n');

describe('seller levels schema', () => {
	it('starts every seller new, with no payout delay set yet', () => {
		expect(schema.stripeConnectAccounts.sellerLevel.default).toBe('new');
		expect(schema.stripeConnectAccounts.payoutDelayDays.notNull).toBe(false);
	});

	it("stores each checkout's weight toward the weekly cap", () => {
		expect(schema.storeCheckouts.weightedCents.default).toBe(0);
	});

	it('holds catalog orders whose payment looks risky', () => {
		expect(CATALOG_ORDER_STATUSES).toContain('risk-hold');
	});

	it('ships the columns in a migration', () => {
		expect(allMigrationSql).toContain('ALTER TABLE `stripe_connect_accounts` ADD `seller_level` text');
		expect(allMigrationSql).toContain('ALTER TABLE `stripe_connect_accounts` ADD `payout_delay_days` integer');
		expect(allMigrationSql).toContain('ALTER TABLE `store_checkouts` ADD `weighted_cents` integer');
		expect(allMigrationSql).toContain('ALTER TABLE `store_disputes` ADD `closed_at` integer');
		// The weekly cap reads a seller's checkouts on every checkout and limits view.
		expect(allMigrationSql).toContain('CREATE INDEX `store_checkouts_seller_idx` ON `store_checkouts` (`seller_user_id`,`mode`,`created_at`)');
	});
});
