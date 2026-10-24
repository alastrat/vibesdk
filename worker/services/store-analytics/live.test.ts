import { beforeAll, describe, expect, it } from 'vitest';
import {
	migratedD1,
	insertUser,
	insertApp,
} from '../../database/test-support/real-d1';
import { getLiveStoreAnalytics } from './live';
import { collectStorePage } from './service';
const NOW = Date.parse('2026-10-24T12:30:00Z');
const SECOND = NOW / 1000;
let db: D1Database;
async function event(id: string, at: number, mode = 'live', app = 'live-a') {
	await db
		.prepare(
			'INSERT INTO store_page_events (id,app_id,mode,visitor_hash,path,source,country,device,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
		)
		.bind(id, app, mode, id, '/coffee', 'Direct', 'CO', 'desktop', at)
		.run();
}
beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'live-owner');
	await insertUser(db, 'live-other');
	await insertApp(db, { id: 'live-a', userId: 'live-owner' });
	await insertApp(db, { id: 'live-b', userId: 'live-other' });
	await event('now', SECOND);
	await event('earlier', SECOND - 3600);
	await event('yesterday', SECOND - 86400);
	await event('yesterday-later', SECOND - 86400 + 1);
	await event('future', SECOND + 100);
	await event('test', SECOND, 'test');
	await event('other', SECOND, 'live', 'live-b');
	for (const [index, currency, cents] of [
		[1, 'usd', 1000],
		[2, 'eur', 700],
		[3, 'usd', 500],
	] as const) {
		await db
			.prepare(
				"INSERT INTO store_orders (id,mode,app_id,order_number,checkout_id,seller_user_id,payment_status,subtotal_cents,shipping_cents,total_cents,application_fee_cents,currency,created_at,updated_at) VALUES (?,'live','live-a',?,?,'live-owner','paid',?,0,?,0,?,?,?)",
			)
			.bind(
				`order-${index}`,
				index,
				`check-${index}`,
				cents,
				cents,
				currency,
				index === 3 ? SECOND - 86400 : SECOND,
				SECOND,
			)
			.run();
	}
	// Events and orders later than the same UTC instant yesterday must not inflate comparison totals.
	for (const [id, mode, at] of [
		['future-order', 'live', SECOND + 1],
		['test-order', 'test', SECOND],
		['yesterday-later-order', 'live', SECOND - 86400 + 1],
	] as const) {
		await db
			.prepare(
				"INSERT INTO store_orders (id,mode,app_id,order_number,checkout_id,seller_user_id,payment_status,subtotal_cents,shipping_cents,total_cents,application_fee_cents,currency,created_at,updated_at) VALUES (?,?,'live-a',?,?,'live-owner','paid',9000,0,9000,0,'usd',?,?)",
			)
			.bind(id, mode, id, id, at, at)
			.run();
	}
});
describe('live store snapshots', () => {
	it('isolates owners/modes and excludes future events', async () => {
		await expect(
			getLiveStoreAnalytics(db, 'live-a', 'live-other', 'live', NOW),
		).rejects.toThrow();
		const data = await getLiveStoreAnalytics(
			db,
			'live-a',
			'live-owner',
			'live',
			NOW,
		);
		expect(data.today.pageViews).toBe(2);
		expect(data.yesterday.pageViews).toBe(1);
		expect(data.hours).toHaveLength(24);
		expect(data.hours[12].pageViews).toBe(1);
		expect(data.hours[12].previousPageViews).toBe(1);
		expect(data.events.map((e) => e.id)).toEqual(['now']);
		expect(data.activeVisitors).toBe(1);
		expect(data.countries).toEqual([{ name: 'CO', views: 1, visitors: 1 }]);
		expect(data.sales.find((s) => s.currency === 'usd')).toMatchObject({
			todayCents: 1000,
			yesterdayCents: 500,
		});
		expect(data.sales.find((s) => s.currency === 'eur')).toMatchObject({
			todayCents: 700,
			yesterdayCents: 0,
		});
		expect(
			(
				await getLiveStoreAnalytics(
					db,
					'live-a',
					'live-owner',
					'test',
					NOW,
				)
			).today.pageViews,
		).toBe(1);
	});
	it('refreshes after the real document collector persists another request', async () => {
		const req = new Request(
			'https://store.example/products/beans?secret=private',
			{
				headers: {
					'CF-Connecting-IP': '192.0.2.6',
					'User-Agent': 'Mozilla/5.0 Chrome',
					'Sec-Fetch-Dest': 'document',
				},
			},
		);
		Object.defineProperty(req, 'cf', { value: { country: 'MX' } });
		const before = await getLiveStoreAnalytics(
			db,
			'live-a',
			'live-owner',
			'live',
			NOW,
		);
		await collectStorePage(
			req,
			new Response('<h1>Beans</h1>', {
				headers: { 'Content-Type': 'text/html' },
			}),
			{ DB: db, JWT_SECRET: 'secret' },
			'live-a',
			NOW,
		);
		const after = await getLiveStoreAnalytics(
			db,
			'live-a',
			'live-owner',
			'live',
			NOW,
		);
		expect(after.today.pageViews).toBe(before.today.pageViews + 1);
		expect(after.events.find((e) => e.country === 'MX')?.path).toBe(
			'/products/beans',
		);
		expect(JSON.stringify(after)).not.toContain('192.0.2.6');
	});
	it('returns a bounded stable event feed and resets the reporting day at UTC midnight', async () => {
		for (let i = 0; i < 55; i++)
			await event(`burst-${String(i).padStart(2, '0')}`, SECOND - i);
		const data = await getLiveStoreAnalytics(
			db,
			'live-a',
			'live-owner',
			'live',
			NOW,
		);
		expect(data.events).toHaveLength(50);
		expect(data.hasMoreEvents).toBe(true);
		expect(new Set(data.events.map((e) => e.id)).size).toBe(50);
		const next = await getLiveStoreAnalytics(
			db,
			'live-a',
			'live-owner',
			'live',
			Date.parse('2026-10-25T00:00:00Z'),
		);
		expect(next.today.pageViews).toBe(0);
		expect(next.events).toEqual([]);
		expect(next.yesterday.pageViews).toBe(0);
	});
});

it('attributes each estimated visitor to their first device and source of the day', async () => {
	await insertApp(db, { id: 'attribution', userId: 'live-owner' });
	for (const [id, source, device, offset] of [
		['first', 'Direct', 'desktop', 60],
		['second', 'search.example', 'mobile', 0],
	] as const)
		await db
			.prepare(
				"INSERT INTO store_page_events (id,app_id,mode,visitor_hash,path,source,country,device,created_at) VALUES (?,'attribution','live','same-visitor','/',?,'CO',?,?)",
			)
			.bind(id, source, device, SECOND - offset)
			.run();
	const result = await getLiveStoreAnalytics(
		db,
		'attribution',
		'live-owner',
		'live',
		NOW,
	);
	expect(result.today.visitors).toBe(1);
	expect(result.sources).toEqual([{ name: 'Direct', views: 2, visitors: 1 }]);
	expect(result.devices).toEqual([
		{ name: 'desktop', views: 2, visitors: 1 },
	]);
});
