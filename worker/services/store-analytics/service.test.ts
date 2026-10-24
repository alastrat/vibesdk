import { beforeAll, describe, expect, it } from 'vitest';
import {
	migratedD1,
	insertUser,
	insertApp,
} from '../../database/test-support/real-d1';
import {
	aggregateStoreAnalytics,
	pageEventOf,
	collectStorePage,
} from './service';
const NOW = Date.parse('2026-10-24T12:00:00Z');
const SECOND = Math.floor(NOW / 1000);
const html = () =>
	new Response('<h1>Store</h1>', {
		headers: { 'Content-Type': 'text/html; charset=utf-8' },
	});
function request(
	headers: Record<string, string> = {},
	url = 'https://shop.example/products/coffee?email=private@example.test',
) {
	return new Request(url, {
		headers: {
			'CF-Connecting-IP': '192.0.2.1',
			'User-Agent': 'Mozilla/5.0 Chrome/130',
			'Sec-Fetch-Dest': 'document',
			'Sec-Fetch-Mode': 'navigate',
			...headers,
		},
	});
}
let testDb: D1Database;
beforeAll(async () => {
	testDb = await migratedD1();
	await insertUser(testDb, 'owner');
	await insertUser(testDb, 'other');
	await insertApp(testDb, { id: 'a', userId: 'owner' });
	await insertApp(testDb, { id: 'b', userId: 'other' });
});
/** Tests use the same generated migration and D1 SQL engine as the Worker. */
function database() {
	const raw = {
		query: (sql: string) => ({
			run: (...values: (string | number | null)[]) =>
				testDb
					.prepare(sql)
					.bind(...values)
					.run(),
			get: () => testDb.prepare(sql).first(),
		}),
		close: () => undefined,
	};
	return { raw, db: testDb };
}
describe('store traffic collection', () => {
	it('stores only sanitized fields and an app-scoped keyed visitor hash', async () => {
		const req = request({
			Referer: 'https://search.example/find?q=secret#token',
		});
		const event = await pageEventOf(req, html(), 'a', 'secret', NOW);
		expect(event).toMatchObject({
			appId: 'a',
			mode: 'live',
			path: '/products/coffee',
			source: 'search.example',
			country: 'Unknown',
			device: 'desktop',
			createdAt: SECOND,
		});
		expect(event?.visitorHash).toMatch(/^[a-f0-9]{64}$/);
		expect(JSON.stringify(event)).not.toContain('192.0.2.1');
		expect(JSON.stringify(event)).not.toContain('Mozilla');
		expect(JSON.stringify(event)).not.toContain('secret');
		expect(
			(await pageEventOf(req, html(), 'a', 'secret', NOW))?.visitorHash,
		).toBe(event?.visitorHash);
		expect(
			(await pageEventOf(req, html(), 'b', 'secret', NOW))?.visitorHash,
		).not.toBe(event?.visitorHash);
		expect(
			(await pageEventOf(req, html(), 'a', 'different-secret', NOW))
				?.visitorHash,
		).not.toBe(event?.visitorHash);
	});
	it('excludes privacy opt-outs, bots, missing IP, assets, previews, fetches, methods and failed responses', async () => {
		for (const headers of [
			{ DNT: '1' },
			{ 'Sec-GPC': '1' },
			{ 'User-Agent': 'Googlebot/2.1' },
			{ 'CF-Connecting-IP': '' },
			{ 'Sec-Fetch-Dest': 'empty' },
			{ 'Sec-Fetch-Mode': 'cors' },
			{ Purpose: 'prefetch' },
		])
			expect(
				await pageEventOf(request(headers), html(), 'a', 'secret', NOW),
			).toBeNull();
		for (const path of [
			'/assets/app.js',
			'/__estori/orders/token',
			'/__preview/index.html',
			'/%5F%5Fpreview/index.html',
		])
			expect(
				await pageEventOf(
					request({}, 'https://shop.example' + path),
					html(),
					'a',
					'secret',
					NOW,
				),
			).toBeNull();
		expect(
			await pageEventOf(
				new Request(request(), { method: 'POST' }),
				html(),
				'a',
				'secret',
				NOW,
			),
		).toBeNull();
		expect(
			await pageEventOf(
				request(),
				new Response('', {
					status: 404,
					headers: { 'Content-Type': 'text/html' },
				}),
				'a',
				'secret',
				NOW,
			),
		).toBeNull();
		expect(
			await pageEventOf(
				request(),
				new Response('{}', {
					headers: { 'Content-Type': 'application/json' },
				}),
				'a',
				'secret',
				NOW,
			),
		).toBeNull();
		expect(await pageEventOf(request(), html(), 'a', '', NOW)).toBeNull();
	});
	it('uses coarse Cloudflare country data and excludes verified bots', async () => {
		const req = request();
		Object.defineProperty(req, 'cf', {
			value: { country: 'CO', botManagement: { verifiedBot: false } },
		});
		expect(
			(await pageEventOf(req, html(), 'a', 'secret', NOW))?.country,
		).toBe('CO');
		const bot = request();
		Object.defineProperty(bot, 'cf', {
			value: { country: 'CO', botManagement: { verifiedBot: true } },
		});
		expect(await pageEventOf(bot, html(), 'a', 'secret', NOW)).toBeNull();
	});
	it('classifies devices and strips sensitive path segments and same-site referrers', async () => {
		const event = await pageEventOf(
			request(
				{
					'User-Agent': 'Mozilla Android Mobile',
					Referer: 'https://shop.example/cart?private=1',
				},
				'https://shop.example/member/ana%40example.test',
			),
			html(),
			'a',
			'secret',
			NOW,
		);
		expect(event).toMatchObject({
			device: 'mobile',
			source: 'Direct',
			path: '/member/[redacted]',
		});
		expect(
			(
				await pageEventOf(
					request({ 'User-Agent': 'Mozilla iPad' }),
					html(),
					'a',
					'secret',
					NOW,
				)
			)?.device,
		).toBe('tablet');
	});
});
describe('store analytics on real migration SQL', () => {
	it('enforces owner and mode boundaries and returns exact refunds, distinct visitors and zero-filled UTC periods', async () => {
		const { raw, db } = database();
		try {
			for (const [id, app, mode, visitor, age] of [
				['p1', 'a', 'live', 'same', 1],
				['p2', 'a', 'live', 'same', 2],
				['p3', 'a', 'live', 'new', 2],
				['prior', 'a', 'live', 'same', 8],
				['test', 'a', 'test', 'test', 1],
				['other', 'b', 'live', 'other', 1],
			] as const)
				await raw
					.query(
						'INSERT INTO store_page_events VALUES (?,?,?,?,?,?,?,?,?)',
					)
					.run(
						id,
						app,
						mode,
						visitor,
						'/coffee',
						'Direct',
						'CO',
						'mobile',
						SECOND - age * 86400,
					);
			for (const [id, seller, mode, refund] of [
				['r', 'owner', 'live', 150],
				['wrong', 'other', 'live', 900],
				['test', 'owner', 'test', 700],
			] as const)
				await raw
					.query(
						"INSERT INTO store_orders(id,app_id,mode,order_number,checkout_id,seller_user_id,subtotal_cents,shipping_cents,total_cents,application_fee_cents,refunded_cents,created_at,updated_at) VALUES (?,'a',?,(SELECT COALESCE(MAX(order_number),0)+1 FROM store_orders),?,?,1000,0,1000,0,?,?,?)",
					)
					.run(id, mode, id, seller, refund, SECOND - 86400, SECOND);
			for (const [id, status, age, seller, mode] of [
				['open', 'open', 3600, 'owner', 'live'],
				['recent', 'open', 60, 'owner', 'live'],
				['expired', 'expired', 7200, 'owner', 'live'],
				['paid', 'completed', 3600, 'owner', 'live'],
				['creating', 'creating', 3600, 'owner', 'live'],
				['failed', 'failed', 3600, 'owner', 'live'],
				['foreign', 'open', 3600, 'other', 'live'],
				['test', 'open', 3600, 'owner', 'test'],
			] as const)
				await raw
					.query(
						"INSERT INTO store_checkouts(id,mode,app_id,commit_hash,seller_user_id,ship_to_country,priced_cart,subtotal_cents,shipping_cents,total_cents,application_fee_cents,status,success_path,cancel_path,created_at,expires_at) VALUES (?,?,'a','commit',?,'CO','{}',0,0,0,0,?,'/','/',?,?)",
					)
					.run(id, mode, seller, status, SECOND - age, SECOND + 3600);
			await expect(
				aggregateStoreAnalytics(db, 'a', 'other', 7, 'live', NOW),
			).rejects.toThrow('Store not found');
			const report = await aggregateStoreAnalytics(
				db,
				'a',
				'owner',
				7,
				'live',
				NOW,
			);
			expect(report.totals).toEqual({
				pageViews: 3,
				visitors: 2,
				checkoutStarts: 4,
				abandonedCheckouts: 2,
				totalRefundedCents: 150,
			});
			expect(report.trend).toHaveLength(7);
			expect(report.previous).toHaveLength(7);
			expect(report.previous.reduce((n, b) => n + b.pageViews, 0)).toBe(
				1,
			);
			expect(report.trend.reduce((n, b) => n + b.visitors, 0)).toBe(3);
			expect(report.trend.at(-1)?.date).toBe('2026-10-24');
			expect(report.sources).toEqual([
				{ name: 'Direct', views: 3, visitors: 2 },
			]);
			expect(report.events).toHaveLength(3);
			expect(
				(
					await aggregateStoreAnalytics(
						db,
						'a',
						'owner',
						7,
						'test',
						NOW,
					)
				).totals.totalRefundedCents,
			).toBe(700);
		} finally {
			raw.close();
		}
	});
	it('bounds recent events and breakdowns, and rejects unbounded periods', async () => {
		const { raw, db } = database();
		try {
			for (let index = 0; index < 25; index++)
				await raw
					.query(
						'INSERT INTO store_page_events VALUES (?,?,?,?,?,?,?,?,?)',
					)
					.run(
						'event-' + index,
						'a',
						'live',
						'visitor-' + index,
						'/page-' + index,
						'source-' + index,
						'CO',
						'desktop',
						SECOND - index,
					);
			const report = await aggregateStoreAnalytics(
				db,
				'a',
				'owner',
				7,
				'live',
				NOW,
			);
			expect(report.events).toHaveLength(20);
			expect(report.events[0].id).toBe('event-0');
			expect(report.events[19].id).toBe('event-19');
			expect(report.pages).toHaveLength(10);
			expect(report.sources).toHaveLength(10);
			expect(report.totals).toMatchObject({
				pageViews: 25,
				visitors: 25,
			});
			await expect(
				aggregateStoreAnalytics(db, 'a', 'owner', 365, 'live', NOW),
			).rejects.toThrow('Invalid reporting');
			const empty = await aggregateStoreAnalytics(
				db,
				'a',
				'owner',
				7,
				'test',
				NOW,
			);
			expect(empty.totals.pageViews).toBe(0);
			expect(empty.trackingSince).toBeNull();
			expect(empty.trend.every((day) => day.pageViews === 0)).toBe(true);
		} finally {
			raw.close();
		}
	});
	it('records without retaining raw identity and removes expired events while preserving recent records', async () => {
		const { raw, db } = database();
		try {
			await raw
				.query(
					'INSERT INTO store_page_events VALUES (?,?,?,?,?,?,?,?,?)',
				)
				.run(
					'old',
					'a',
					'live',
					'h',
					'/',
					'Direct',
					'Unknown',
					'desktop',
					SECOND - 181 * 86400,
				);
			await collectStorePage(
				request(),
				html(),
				{ DB: db, JWT_SECRET: 'secret' },
				'a',
				NOW,
			);
			expect(
				await raw
					.query('SELECT count(*) AS n FROM store_page_events')
					.get(),
			).toEqual({ n: 1 });
			const report = await aggregateStoreAnalytics(
				db,
				'a',
				'owner',
				7,
				'live',
				NOW,
			);
			expect(report.totals.pageViews).toBe(1);
			expect(report.events[0]).not.toHaveProperty('visitorHash');
			expect(report.events[0].kind).toBe('page_view');
		} finally {
			raw.close();
		}
	});
});
