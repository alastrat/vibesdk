import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';
import { SitePageService } from './services/SitePageService';
import { recordingD1 } from './test-support/recording-d1';

const migrations = import.meta.glob<string>('/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const allMigrationSql = Object.values(migrations).join('\n');

const COPY = {
	tagline: 'A calm site',
	about: ['About it.'],
	features: ['a', 'b', 'c'],
	includes: [{ name: 'Home', detail: 'The one page' }],
	madeFor: ['Studios', 'Teachers'],
};

describe('site page storage', () => {
	it('keeps one page row per app, removed with the app', () => {
		const config = getTableConfig(schema.sitePages);
		expect(config.name).toBe('site_pages');
		expect(config.columns.map((column) => column.name).sort()).toEqual(['app_id', 'copy', 'updated_at']);
		const appId = config.columns.find((column) => column.name === 'app_id');
		expect(appId?.primary).toBe(true);
		expect(config.foreignKeys[0]?.onDelete).toBe('cascade');
	});

	it('stores the text sent with each paid version', () => {
		const column = getTableConfig(schema.templateVersions).columns.find((entry) => entry.name === 'page_copy');
		expect(column?.notNull).toBe(false);
	});

	it('ships the table and column in a migration', () => {
		expect(allMigrationSql).toContain('CREATE TABLE `site_pages`');
		expect(allMigrationSql).toContain('ALTER TABLE `template_versions` ADD `page_copy` text');
	});
});

describe('SitePageService', () => {
	it('upserts the saved text as JSON', async () => {
		const { d1, statements } = recordingD1();
		await new SitePageService({ DB: d1 } as unknown as Env).saveCopy('app1', COPY);
		const sql = statements[0].sql.toLowerCase();
		expect(sql).toContain('insert into "site_pages"');
		expect(sql).toContain('on conflict ("site_pages"."app_id") do update');
		expect(statements[0].params).toContain(JSON.stringify(COPY));
	});

	it('deletes the row when the text is cleared', async () => {
		const { d1, statements } = recordingD1();
		await new SitePageService({ DB: d1 } as unknown as Env).saveCopy('app1', null);
		expect(statements[0].sql.toLowerCase()).toBe('delete from "site_pages" where "site_pages"."app_id" = ?');
		expect(statements[0].params).toEqual(['app1']);
	});

	it("lists the creator's other Discover sites, newest first", async () => {
		const { d1, statements } = recordingD1();
		await new SitePageService({ DB: d1 } as unknown as Env).listCreatorSites('u1', 'app1', 4);
		const sql = statements[0].sql.toLowerCase();
		expect(sql).toContain('"apps"."user_id" = ?');
		expect(sql).toContain('"apps"."visibility" = ?');
		expect(sql).toContain('"apps"."id" <> ?');
		expect(sql).toContain('removed_from_discover_at" is null');
		expect(sql).toContain('order by "apps"."updated_at" desc');
		expect(statements[0].params).toEqual(expect.arrayContaining(['u1', 'public', 'app1', 4]));
	});

	it('marks a creator site paid while any paid listing is listed, approved or not', async () => {
		const { d1, statements } = recordingD1([
			['a1', 'Free site', null, null, 0],
			['a2', 'Paid, in review', null, null, 1],
			['a3', 'Paid, approved', 'https://shots.test/a3.png', 2900, 1],
		]);
		const sites = await new SitePageService({ DB: d1 } as unknown as Env).listCreatorSites('u1', 'app1', 4);
		expect(statements[0].sql).toContain(
			`exists (select 1 from templates as listing where listing.source_app_id = "apps"."id" and listing.status = 'listed')`,
		);
		expect(sites).toEqual([
			{ id: 'a1', title: 'Free site', screenshotUrl: null, priceCents: null, paid: false },
			{ id: 'a2', title: 'Paid, in review', screenshotUrl: null, priceCents: null, paid: true },
			{ id: 'a3', title: 'Paid, approved', screenshotUrl: 'https://shots.test/a3.png', priceCents: 2900, paid: true },
		]);
	});
});
