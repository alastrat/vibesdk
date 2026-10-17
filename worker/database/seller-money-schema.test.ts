import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';
import { CATALOG_ITEM_STATUSES } from '../../shared/types/catalog';

const migrations = import.meta.glob<string>('/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const allMigrationSql = Object.values(migrations).join('\n');

function uniqueIndex(table: Parameters<typeof getTableConfig>[0], name: string): boolean {
	return getTableConfig(table).indexes.find((index) => index.config.name === name)?.config.unique === true;
}

describe('seller money schema', () => {
	it('claims each order line once before Stripe is called, whoever asks, and keeps the refund and its reversal', () => {
		expect(uniqueIndex(schema.storeRefunds, 'store_refunds_order_line_unique_idx')).toBe(true);
		expect(schema.storeRefunds.initiatedBy.enumValues).toEqual(['seller', 'estori']);
		expect(schema.storeRefunds.stripeRefundId.notNull).toBe(false);
		expect(schema.storeRefunds.reversalId.notNull).toBe(false);
		expect(schema.storeRefunds.reversalCents.default).toBe(0);
	});

	it('plans each money move before Stripe is called: dispute reversals, fee differences and charge collections', () => {
		expect(schema.storeDisputes.reversalState.default).toBe('none');
		expect(schema.storeFeeAdjustments.differenceCents.default).toBe(0);
		expect(schema.sellerChargeCollections.reversalId.notNull).toBe(false);
	});

	it('keeps one charge per kind and source, so a redelivered event charges once', () => {
		expect(uniqueIndex(schema.sellerCharges, 'seller_charges_kind_source_unique_idx')).toBe(true);
		expect(schema.sellerCharges.kind.enumValues).toEqual(['dispute-fee', 'dispute-shortfall', 'payout-fee', 'active-account-fee', 'refund-shortfall']);
		expect(schema.sellerCharges.collectedCents.default).toBe(0);
		expect(uniqueIndex(schema.sellerChargeCollections, 'seller_charge_collections_unique_idx')).toBe(true);
	});

	it('keys disputes and fee adjustments by their Stripe dispute and store order', () => {
		expect(getTableConfig(schema.storeDisputes).columns.find((column) => column.name === 'id')?.primary).toBe(true);
		expect(getTableConfig(schema.storeFeeAdjustments).columns.find((column) => column.name === 'order_id')?.primary).toBe(true);
	});

	it('pays sellers weekly on Monday unless they choose otherwise', () => {
		expect(schema.stripeConnectAccounts.payoutInterval.default).toBe('weekly');
		expect(schema.stripeConnectAccounts.payoutAnchor.default).toBe('monday');
	});

	it('withholds catalog items a dispute already paid back', () => {
		expect(CATALOG_ITEM_STATUSES).toContain('withheld');
	});

	it('ships the tables in a migration', () => {
		for (const table of ['store_refunds', 'store_disputes', 'seller_charges', 'seller_charge_collections', 'store_fee_adjustments']) {
			expect(allMigrationSql).toContain(`CREATE TABLE \`${table}\``);
		}
	});
});
