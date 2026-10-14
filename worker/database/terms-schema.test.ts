import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';
import { mapUserResponse } from '../utils/authUtils';
import { TERMS_VERSION } from '../../shared/types/legal';

const migrations = import.meta.glob<string>('/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const allMigrationSql = Object.values(migrations).join('\n');

describe('terms agreement on users', () => {
	it('adds nullable agreement columns, so existing users have no recorded agreement', () => {
		const columns = getTableConfig(schema.users).columns;
		const acceptedAt = columns.find((column) => column.name === 'terms_accepted_at');
		const version = columns.find((column) => column.name === 'terms_version');
		expect(acceptedAt?.notNull).toBe(false);
		expect(version?.notNull).toBe(false);
	});

	it('ships both columns in a migration', () => {
		expect(allMigrationSql).toContain('ALTER TABLE `users` ADD `terms_accepted_at` integer');
		expect(allMigrationSql).toContain('ALTER TABLE `users` ADD `terms_version` text');
	});

	it('reports termsAccepted only when the row carries the terms version', () => {
		const base = { id: 'u1', email: 'a@example.test' };
		expect(mapUserResponse({ ...base, termsVersion: TERMS_VERSION }).termsAccepted).toBe(true);
		expect(mapUserResponse({ ...base, termsVersion: '2020-01-01' }).termsAccepted).toBe(false);
		expect(mapUserResponse({ ...base, termsVersion: null }).termsAccepted).toBe(false);
		expect('termsAccepted' in mapUserResponse(base)).toBe(false);
	});
});
