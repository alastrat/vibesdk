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

describe('templates schema', () => {
	it('gives every user a role that defaults to user', () => {
		expect(schema.users.role.enumValues).toEqual(['user', 'admin']);
		expect(schema.users.role.notNull).toBe(true);
		expect(schema.users.role.default).toBe('user');
	});

	it('records the template version an app started from', () => {
		expect(schema.apps.fromTemplateVersionId.name).toBe('from_template_version_id');
		expect(schema.apps.fromTemplateVersionId.notNull).toBe(false);
	});

	it('keeps one template per source app behind a unique slug', () => {
		expect(schema.templates.slug.isUnique).toBe(true);
		expect(indexNamed(schema.templates, 'templates_source_app_unique_idx')?.config.unique).toBe(true);
		expect(schema.templates.category.enumValues).toEqual([
			'store',
			'landing',
			'portfolio',
			'restaurant',
			'saas',
			'services',
			'other',
		]);
		expect(schema.templates.status.default).toBe('unlisted');
		expect(schema.templates.priceCents.default).toBe(0);
		expect(schema.templates.priceCents.notNull).toBe(true);
	});

	it('records one purchase per user and template', () => {
		expect(
			indexNamed(schema.templatePurchases, 'template_purchases_template_user_unique_idx')?.config.unique,
		).toBe(true);
		expect(schema.templatePurchases.provider.enumValues).toEqual(['test']);
	});

	it('numbers versions once per template and starts them pending', () => {
		expect(
			indexNamed(schema.templateVersions, 'template_versions_template_version_unique_idx')?.config.unique,
		).toBe(true);
		expect(schema.templateVersions.status.enumValues).toEqual([
			'pending',
			'approved',
			'rejected',
			'withdrawn',
			'superseded',
		]);
		expect(schema.templateVersions.status.default).toBe('pending');
	});

	it('ships a migration for the new tables and columns', () => {
		expect(allMigrationSql).toContain('CREATE TABLE `templates`');
		expect(allMigrationSql).toContain('CREATE TABLE `template_versions`');
		expect(allMigrationSql).toMatch(/ALTER TABLE `users` ADD `role` text[^;]*DEFAULT 'user'/);
		expect(allMigrationSql).toContain('ALTER TABLE `apps` ADD `from_template_version_id` text');
		expect(allMigrationSql).toContain('CREATE TABLE `template_purchases`');
	});

	it('promotes the platform admin account', () => {
		expect(allMigrationSql).toContain(
			"UPDATE `users` SET `role` = 'admin' WHERE `email` = 'alastrat@pluriza.com';",
		);
	});
});
