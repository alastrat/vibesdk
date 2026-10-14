import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';
import { EarlyAccessService } from './services/EarlyAccessService';
import { recordingD1 } from './test-support/recording-d1';

const migrations = import.meta.glob<string>('/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const allMigrationSql = Object.values(migrations).join('\n');

describe('early access storage', () => {
	it('keeps one request per user and program, removed with the account', () => {
		const config = getTableConfig(schema.earlyAccessRequests);
		expect(config.name).toBe('early_access_requests');
		expect(config.columns.map((column) => column.name).sort()).toEqual(['capability', 'created_at', 'id', 'user_id']);
		expect(config.foreignKeys[0]?.onDelete).toBe('cascade');
		const unique = config.indexes.find((index) => index.config.name === 'early_access_requests_user_capability_idx');
		expect(unique?.config.unique).toBe(true);
	});

	it('ships the table in a migration', () => {
		expect(allMigrationSql).toContain('CREATE TABLE `early_access_requests`');
		expect(allMigrationSql).toContain('CREATE UNIQUE INDEX `early_access_requests_user_capability_idx`');
	});
});

describe('EarlyAccessService', () => {
	it('records a request once, ignoring a repeat', async () => {
		const { d1, statements } = recordingD1();
		await new EarlyAccessService({ DB: d1 } as unknown as Env).request('u1', 'digital-products');
		const sql = statements[0].sql.toLowerCase();
		expect(sql).toContain('insert into "early_access_requests"');
		expect(sql).toContain('on conflict');
		expect(sql).toContain('do nothing');
		expect(statements[0].params).toContain('u1');
		expect(statements[0].params).toContain('digital-products');
	});

	it("lists the user's requests, dropping programs that no longer exist", async () => {
		const { d1, statements } = recordingD1([['digital-products'], ['retired-program']]);
		const capabilities = await new EarlyAccessService({ DB: d1 } as unknown as Env).listForUser('u1');
		expect(capabilities).toEqual(['digital-products']);
		expect(statements[0].sql.toLowerCase()).toContain('"early_access_requests"."user_id" = ?');
	});

	it('lists every request with who asked, newest first', async () => {
		const { d1, statements } = recordingD1([
			['content-creators', 'ana@example.com', 'Ana', 1_760_400_000],
			['retired-program', 'bo@example.com', 'Bo', 1_760_300_000],
		]);
		const rows = await new EarlyAccessService({ DB: d1 } as unknown as Env).listAll();
		expect(rows).toEqual([{ capability: 'content-creators', email: 'ana@example.com', displayName: 'Ana', createdAt: new Date(1_760_400_000 * 1000) }]);
		const sql = statements[0].sql.toLowerCase();
		expect(sql).toContain('inner join "users"');
		expect(sql).toContain('order by "early_access_requests"."created_at" desc');
	});
});
