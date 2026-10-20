/** The analytics setting on real SQL: kept in `users.preferences` beside whatever else is there. */
import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertUser, migratedD1 } from '../test-support/real-d1';
import { AnalyticsPersonService } from './AnalyticsPersonService';

let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	for (const id of ['ana_1', 'ana_2', 'ana_3']) await insertUser(db, id);
	await db.prepare(`UPDATE users SET preferences = '{"theme":"dark"}' WHERE id = 'ana_3'`).run();
	await db.prepare(`UPDATE users SET preferences = NULL WHERE id = 'ana_2'`).run();
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
