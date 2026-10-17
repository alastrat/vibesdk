import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';
import { ContactService } from './services/ContactService';
import { recordingD1 } from './test-support/recording-d1';

const migrations = import.meta.glob<string>('/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const allMigrationSql = Object.values(migrations).join('\n');

describe('contact request storage', () => {
	it('keeps who wrote, about what, and when, without tying it to an account', () => {
		const config = getTableConfig(schema.contactRequests);
		expect(config.name).toBe('contact_requests');
		expect(config.columns.map((column) => column.name).sort()).toEqual([
			'company',
			'company_size',
			'created_at',
			'email',
			'first_name',
			'id',
			'last_name',
			'message',
			'premium_credits',
			'topic',
		]);
		expect(config.foreignKeys).toHaveLength(0);
		expect(config.indexes.map((index) => index.config.name)).toContain('contact_requests_created_at_idx');
	});

	it('ships the table in a migration', () => {
		expect(allMigrationSql).toContain('CREATE TABLE `contact_requests`');
		expect(allMigrationSql).toContain('CREATE INDEX `contact_requests_created_at_idx`');
	});
});

describe('ContactService', () => {
	it('stores a request', async () => {
		const { d1, statements } = recordingD1();
		await new ContactService({ DB: d1 } as unknown as Env).create({
			firstName: 'Ana',
			lastName: 'Ruiz',
			email: 'ana@example.com',
			company: 'North Ridge',
			companySize: '2–10',
			topic: 'premium',
			message: null,
			premiumCredits: 50_000,
		});
		expect(statements[0].sql.toLowerCase()).toContain('insert into "contact_requests"');
		for (const value of ['Ana', 'Ruiz', 'ana@example.com', 'North Ridge', '2–10', 'premium', 50_000]) expect(statements[0].params).toContain(value);
	});

	it('lists the latest requests, newest first, leaving out topics and sizes that no longer exist', async () => {
		const { d1, statements } = recordingD1([
			['c1', 'Ana', 'Ruiz', 'ana@example.com', 'North Ridge', '2–10', 'enterprise', null, null, 1_760_500_000],
			['c2', 'Bo', 'Li', 'bo@example.com', 'Old Co', '2–10', 'retired-topic', null, null, 1_760_400_000],
		]);
		const rows = await new ContactService({ DB: d1 } as unknown as Env).listRecent();
		expect(rows.map((row) => row.id)).toEqual(['c1']);
		expect(rows[0].createdAt).toEqual(new Date(1_760_500_000 * 1000));
		const sql = statements[0].sql.toLowerCase();
		expect(sql).toContain('order by "contact_requests"."created_at" desc');
		expect(sql).toContain('limit ?');
	});
});
