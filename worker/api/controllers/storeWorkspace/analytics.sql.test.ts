import { beforeAll, describe, expect, it } from 'vitest';
import { StoreAnalyticsController } from './analytics';
import {
	migratedD1,
	insertUser,
	insertApp,
	envWith,
} from '../../../database/test-support/real-d1';
import type { RouteContext } from '../../types/route-context';
let db: D1Database;
const context = (id = 'owner') =>
	({
		user: { id, isAnonymous: false },
		pathParams: { id: 'store' },
	}) as RouteContext;
const call = (query: string, owner = 'owner') =>
	StoreAnalyticsController.analytics(
		new Request(`https://estori.app/api/stores/store/analytics${query}`),
		envWith(db),
		{} as ExecutionContext,
		context(owner),
	);
beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'owner');
	await insertUser(db, 'other');
	await insertApp(db, { id: 'store', userId: 'owner' });
	await db
		.prepare(
			"INSERT INTO store_page_events (id,app_id,mode,visitor_hash,path,source,country,device,created_at) VALUES ('event','store','test','visitor','/','Direct','CO','desktop',?)",
		)
		.bind(Math.floor(Date.now() / 1000))
		.run();
});
describe('private store analytics endpoint', () => {
	it('keeps owner data private and test traffic separate from live', async () => {
		const response = await call('?days=7&mode=test');
		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toBe('private, no-store');
		const body = (await response.json()) as {
			data: { totals: { pageViews: number }; mode: string };
		};
		expect(body.data.totals.pageViews).toBe(1);
		expect(body.data.mode).toBe('test');
		const live = (await (await call('?days=7')).json()) as {
			data: { totals: { pageViews: number } };
		};
		expect(live.data.totals.pageViews).toBe(0);
	});
	it('accepts single-day historical ranges', async () => {
		const yesterday = new Date(Date.now() - 86400000)
			.toISOString()
			.slice(0, 10);
		const response = await call(`?days=1&mode=test&through=${yesterday}`);
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			data: { totals: { pageViews: number }; trend: { date: string }[] };
		};
		expect(body.data.totals.pageViews).toBe(0);
		expect(body.data.trend).toHaveLength(1);
		expect(body.data.trend[0].date).toBe(yesterday);
	});
	it('refuses another owner and validates reporting parameters', async () => {
		expect((await call('?days=7', 'other')).status).toBe(404);
		for (const query of [
			'?days=999',
			'?days=7&mode=all',
			'?days=NaN',
			'?days=1&through=2026-02-30',
			'?days=1&through=2999-01-01',
			'?days=1&product=',
		])
			expect((await call(query)).status).toBe(400);
	});
});
