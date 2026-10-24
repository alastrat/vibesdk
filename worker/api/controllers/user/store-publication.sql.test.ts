import { beforeAll, describe, expect, it } from 'vitest';
import {
	envWith,
	insertApp,
	insertUser,
	migratedD1,
} from '../../../database/test-support/real-d1';
import { AppService } from '../../../database/services/AppService';
import { LiveStoreService } from '../../../database/services/LiveStoreService';
import { UserController } from './controller';
import type { UserAppsData } from './types';
import type { RouteContext } from '../../types/route-context';

let db: D1Database;
let env: Env;
beforeAll(async () => {
	db = await migratedD1();
	env = envWith(db, { JWT_SECRET: 'Test-Only-Store-Publication-Secret-2026!' });
	await insertUser(db, 'seller');
	await insertUser(db, 'other');
	for (const [index, id] of [
		'draft',
		'offline',
		'live-a',
		'live-b',
		'foreign',
	].entries()) {
		await insertApp(db, {
			id,
			userId: id === 'foreign' ? 'other' : 'seller',
		});
		await db
			.prepare(
				'UPDATE apps SET updated_at = ?, visibility = ? WHERE id = ?',
			)
			.bind(1000 + index, id === 'draft' ? 'public' : 'private', id)
			.run();
		if (id !== 'draft')
			await new LiveStoreService(env).publish({
				appId: id,
				slug: id,
				commit: `secret-${id}`,
				now: new Date('2026-10-20T12:00:00Z'),
			});
	}
	await new LiveStoreService(env).setOffline('offline', new Date());
});
function read(query: string, userId: string | null = 'seller') {
	return UserController.getApps(
		new Request(`https://example.test/api/user/apps?${query}`),
		env,
		{} as ExecutionContext,
		{ user: userId ? { id: userId } : null } as RouteContext,
	);
}
async function data(query: string) {
	const response = await read(query);
	expect(response.status).toBe(200);
	return ((await response.json()) as { data: UserAppsData }).data;
}

describe('owner store publication list', () => {
	it('filters publication before pagination and counts every matching owner store', async () => {
		const first = await data('publication=live&limit=1&page=1');
		const second = await data('publication=live&limit=1&page=2');
		expect(first.pagination).toEqual({
			total: 2,
			limit: 1,
			offset: 0,
			hasMore: true,
		});
		expect(second.pagination).toEqual({
			total: 2,
			limit: 1,
			offset: 1,
			hasMore: false,
		});
		expect(
			new Set([...first.apps, ...second.apps].map((app) => app.id)),
		).toEqual(new Set(['live-a', 'live-b']));
		expect(first.apps[0].publication).toEqual({
			status: 'live',
			publishedAt: '2026-10-20T12:00:00.000Z',
		});
		expect(JSON.stringify(first.apps[0].publication)).not.toContain(
			'secret',
		);
	});
	it('distinguishes draft/offline and combines publication with visibility', async () => {
		expect(
			(await data('publication=draft')).apps.map((app) => app.id),
		).toEqual(['draft']);
		expect(
			(await data('publication=offline')).apps.map((app) => app.id),
		).toEqual(['offline']);
		expect(
			(await data('publication=live&visibility=public')).pagination.total,
		).toBe(0);
		expect(
			(await data('publication=draft&visibility=public')).apps[0]
				.publication,
		).toEqual({ status: 'draft', publishedAt: null });
	});
	it('summarizes only owned IDs even when given a foreign public store', async () => {
		await db
			.prepare(
				"UPDATE apps SET visibility = 'public' WHERE id = 'foreign'",
			)
			.run();
		const summaries = await new AppService(env).getPublicationSummaries(
			'seller',
			['draft', 'foreign'],
		);
		expect([...summaries.keys()]).toEqual(['draft']);
		expect((await data('')).apps).toHaveLength(4);
	});
	it('keeps search and favorites scoped within publication filters', async () => {
		await db
			.prepare(
				"INSERT INTO favorites (id, user_id, app_id) VALUES ('favorite-live', 'seller', 'live-a')",
			)
			.run();
		const found = await data('publication=live&sort=starred&search=live');
		expect(found.apps.map((app) => app.id)).toEqual(['live-a']);
		expect(found.pagination.total).toBe(1);
	});
	it('rejects missing identity and unknown publication filters', async () => {
		expect((await read('', null)).status).toBe(401);
		expect((await read('publication=public')).status).toBe(400);
	});
	it('bounds the summary batch and uses no per-store lookups', async () => {
		const result = await data('limit=10000');
		expect(result.pagination.limit).toBe(100);
		expect(result.apps.every((app) => app.publication)).toBe(true);
	});
});
