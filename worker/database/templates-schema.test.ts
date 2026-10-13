import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

const migrations = import.meta.glob<string>('/migrations/*.sql', {
	query: '?raw',
	import: 'default',
	eager: true,
});
const allMigrationSql = Object.values(migrations).join('\n');

function indexNamed(table: Parameters<typeof getTableConfig>[0], name: string) {
	return getTableConfig(table).indexes.find((index) => index.config.name === name);
}

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
	return getTableConfig(table).columns.map((column) => column.name);
}

describe('publishing schema', () => {
	it('gives every user a role that defaults to user', () => {
		expect(schema.users.role.enumValues).toEqual(['user', 'admin']);
		expect(schema.users.role.notNull).toBe(true);
		expect(schema.users.role.default).toBe('user');
	});

	it('stores the publishing choices and admin removal on the app', () => {
		expect(schema.apps.category.enumValues).toEqual([
			'store',
			'landing',
			'portfolio',
			'restaurant',
			'saas',
			'services',
			'other',
		]);
		expect(schema.apps.category.notNull).toBe(false);
		expect(schema.apps.reuseConsentAt.name).toBe('reuse_consent_at');
		expect(schema.apps.removedFromDiscoverAt.notNull).toBe(false);
		expect(schema.apps.removedFromDiscoverBy.name).toBe('removed_from_discover_by');
		expect(schema.apps.removedFromDiscoverReason.name).toBe('removed_from_discover_reason');
		expect(schema.apps.fromTemplateVersionId.notNull).toBe(false);
	});

	it('keeps one paid listing per app and takes its name from the app', () => {
		expect(schema.templates.sourceAppId.notNull).toBe(true);
		expect(indexNamed(schema.templates, 'templates_source_app_unique_idx')?.config.unique).toBe(true);
		for (const dropped of ['slug', 'name', 'description', 'category', 'use_count']) {
			expect(columnNames(schema.templates)).not.toContain(dropped);
		}
		expect(schema.templates.status.default).toBe('listed');
		expect(schema.templates.priceCents.default).toBe(0);
	});

	it('records the price each version asks for', () => {
		expect(schema.templateVersions.priceCents.notNull).toBe(true);
		expect(
			indexNamed(schema.templateVersions, 'template_versions_template_version_unique_idx')?.config.unique,
		).toBe(true);
		expect(schema.templateVersions.status.default).toBe('pending');
	});

	it('keeps purchases when a listing is deleted', () => {
		expect(schema.templatePurchases.templateId.notNull).toBe(false);
		const listingKey = getTableConfig(schema.templatePurchases).foreignKeys.find(
			(key) => key.reference().foreignTable === schema.templates,
		);
		expect(listingKey?.onDelete).toBe('set null');
		expect(schema.templatePurchases.provider.enumValues).toEqual(['test']);
	});

	it('ships the tables and columns in a migration', () => {
		expect(allMigrationSql).toContain('CREATE TABLE `templates`');
		expect(allMigrationSql).toContain('CREATE TABLE `template_versions`');
		expect(allMigrationSql).toContain('CREATE TABLE `template_purchases`');
		expect(allMigrationSql).toContain('ALTER TABLE `apps` ADD `category` text');
		expect(allMigrationSql).toContain('ALTER TABLE `apps` ADD `reuse_consent_at` integer');
		expect(allMigrationSql).toContain('ALTER TABLE `apps` ADD `removed_from_discover_at` integer');
		expect(allMigrationSql).toContain('ALTER TABLE `apps` ADD `from_template_version_id` text');
		expect(allMigrationSql).toMatch(/ALTER TABLE `users` ADD `role` text[^;]*DEFAULT 'user'/);
	});

	it('promotes the platform admin account', () => {
		expect(allMigrationSql).toContain(
			"UPDATE `users` SET `role` = 'admin' WHERE `email` = 'alastrat@pluriza.com';",
		);
	});
});
