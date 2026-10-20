/** The analytics setting on real SQL: kept in `users.preferences` beside whatever else is there. */
import { beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { envWith, insertUser, migratedD1 } from '../test-support/real-d1';
import * as schema from '../schema';
import { AnalyticsPersonService } from './AnalyticsPersonService';

let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	for (const id of ['ana_1', 'ana_2', 'ana_3', 'ana_4', 'ana_5']) await insertUser(db, id);
	await db.prepare(`UPDATE users SET preferences = '{"theme":"dark"}' WHERE id = 'ana_3'`).run();
	await db.prepare(`UPDATE users SET preferences = NULL WHERE id = 'ana_2'`).run();
	// Rows made through drizzle before the default became an object hold the JSON string "{}".
	await db.prepare(`UPDATE users SET preferences = '"{}"' WHERE id = 'ana_4'`).run();
	await db.prepare(`UPDATE users SET preferences = 'not json' WHERE id = 'ana_5'`).run();
});

describe('the analytics setting', () => {
	it('starts on, with no source', async () => {
		expect(await new AnalyticsPersonService(envWith(db)).preference('ana_1')).toEqual({ optedOut: false, source: null });
	});

	it('stores an opt-out with its source, keeping other preferences, even from an empty column', async () => {
		const people = new AnalyticsPersonService(envWith(db));
		await people.setPreference('ana_3', true, 'gpc', new Date());
		await people.setPreference('ana_2', true, 'settings', new Date());
		expect(await people.preference('ana_3')).toEqual({ optedOut: true, source: 'gpc' });
		expect(await people.preference('ana_2')).toEqual({ optedOut: true, source: 'settings' });
		const row = await db.prepare(`SELECT json_extract(preferences, '$.theme') AS theme FROM users WHERE id = 'ana_3'`).first<{ theme: string }>();
		expect(row?.theme).toBe('dark');
	});

	it('finds who opted out among more ids than D1 binds at once', async () => {
		const people = new AnalyticsPersonService(envWith(db));
		await people.setPreference('ana_2', true, 'settings', new Date());
		await people.setPreference('ana_3', true, 'gpc', new Date());
		const ids = [...Array.from({ length: 120 }, (_, i) => `missing_${i}`), 'ana_1', 'ana_2', 'ana_3'];
		expect([...(await people.optedOutAmong(ids))].sort()).toEqual(['ana_2', 'ana_3']);
		expect(await people.optedOutAmong([])).toEqual(new Set());
	});

	it('turns analytics back on and clears the source', async () => {
		const people = new AnalyticsPersonService(envWith(db));
		await people.setPreference('ana_1', true, 'settings', new Date());
		await people.setPreference('ana_1', false, 'settings', new Date());
		expect(await people.preference('ana_1')).toEqual({ optedOut: false, source: null });
		expect(await people.optedOutAmong(['ana_1'])).toEqual(new Set());
	});
});

describe('rows whose preferences are not a JSON object', () => {
	it('saves an opt-out over a stored JSON string, and turns analytics back on', async () => {
		const people = new AnalyticsPersonService(envWith(db));
		await people.setPreference('ana_4', true, 'settings', new Date());
		expect(await people.preference('ana_4')).toEqual({ optedOut: true, source: 'settings' });
		await people.setPreference('ana_4', false, 'settings', new Date());
		expect(await people.preference('ana_4')).toEqual({ optedOut: false, source: null });
	});

	it('saves an opt-out over invalid JSON', async () => {
		const people = new AnalyticsPersonService(envWith(db));
		await people.setPreference('ana_5', true, 'gpc', new Date());
		expect(await people.preference('ana_5')).toEqual({ optedOut: true, source: 'gpc' });
	});

	it('keeps the other keys of a stored object', async () => {
		const people = new AnalyticsPersonService(envWith(db));
		await db.prepare(`UPDATE users SET preferences = '{"theme":"dark","keep":1}' WHERE id = 'ana_1'`).run();
		await people.setPreference('ana_1', true, 'settings', new Date());
		const row = await db.prepare(`SELECT json_extract(preferences, '$.theme') AS theme, json_extract(preferences, '$.keep') AS keep FROM users WHERE id = 'ana_1'`).first<{ theme: string; keep: number }>();
		expect(row).toEqual({ theme: 'dark', keep: 1 });
	});

	it('stores a JSON object for a user inserted through drizzle without preferences', async () => {
		await drizzle(db, { schema }).insert(schema.users).values({ id: 'ana_drizzle', email: 'ana_drizzle@example.test', displayName: 'ana_drizzle', provider: 'email', providerId: 'ana_drizzle' }).run();
		const row = await db.prepare(`SELECT json_type(preferences) AS type FROM users WHERE id = 'ana_drizzle'`).first<{ type: string }>();
		expect(row?.type).toBe('object');
	});
});
