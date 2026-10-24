import type {
	StoreLiveAnalytics,
	StoreTrafficBreakdown,
} from '../../../shared/types/store-analytics';
import { StoreAnalyticsAccessError } from './service';
const DAY = 86400;
interface TrafficHour {
	stamp: number;
	views: number;
}
interface SaleHour {
	stamp: number;
	currency: string;
	cents: number;
}
interface EventRow {
	id: string;
	path: string;
	country: string;
	device: string;
	source: string;
	createdAt: number;
}

/** Bounded indexed reads; never returns shopper identities or sums different currencies. */
export async function getLiveStoreAnalytics(
	db: D1Database,
	appId: string,
	ownerId: string,
	mode: 'live' | 'test',
	now = Date.now(),
): Promise<StoreLiveAnalytics> {
	if (!['live', 'test'].includes(mode) || !Number.isFinite(now))
		throw new Error('Invalid live analytics mode');
	if (
		!(await db
			.prepare('SELECT id FROM apps WHERE id=? AND user_id=?')
			.bind(appId, ownerId)
			.first())
	)
		throw new StoreAnalyticsAccessError();
	const until = Math.floor(now / 1000) + 1;
	const start = Math.floor(now / 1000 / DAY) * DAY;
	const priorStart = start - DAY;
	const priorUntil = until - DAY;
	const recentStart = until - 300;
	const where = 'app_id=? AND mode=? AND created_at>=? AND created_at<?';
	const totals = (from: number, to: number) =>
		db
			.prepare(
				`SELECT COUNT(*) AS pageViews,COUNT(DISTINCT visitor_hash) AS visitors FROM store_page_events WHERE ${where}`,
			)
			.bind(appId, mode, from, to)
			.first<{ pageViews: number; visitors: number }>();
	const breakdown = async (
		column: 'source' | 'device' | 'country',
		from: number,
	) =>
		(
			await db
				.prepare(
					`SELECT ${column} AS name,COUNT(*) AS views,COUNT(DISTINCT visitor_hash) AS visitors FROM store_page_events WHERE ${where} GROUP BY ${column} ORDER BY views DESC,name ASC`,
				)
				.bind(appId, mode, from, until)
				.all<StoreTrafficBreakdown>()
		).results;
	const attributed = async (column: 'source' | 'device') =>
		(
			await db
				.prepare(
					`WITH visits AS (SELECT ${column},COUNT(*) OVER (PARTITION BY visitor_hash) AS views,ROW_NUMBER() OVER (PARTITION BY visitor_hash ORDER BY created_at,id) AS position FROM store_page_events WHERE ${where}) SELECT ${column} AS name,SUM(views) AS views,COUNT(*) AS visitors FROM visits WHERE position=1 GROUP BY ${column} ORDER BY visitors DESC,name ASC LIMIT 6`,
				)
				.bind(appId, mode, start, until)
				.all<StoreTrafficBreakdown>()
		).results;

	const [
		today,
		yesterday,
		active,
		traffic,
		sales,
		devices,
		sources,
		countries,
		events,
	] = await Promise.all([
		totals(start, until),
		totals(priorStart, priorUntil),
		totals(recentStart, until),
		db
			.prepare(
				`SELECT CAST(created_at/3600 AS INTEGER)*3600 AS stamp,COUNT(*) AS views FROM store_page_events WHERE ${where} AND (created_at>=? OR created_at<?) GROUP BY stamp`,
			)
			.bind(appId, mode, priorStart, until, start, priorUntil)
			.all<TrafficHour>(),
		db
			.prepare(
				"SELECT CAST(created_at/3600 AS INTEGER)*3600 AS stamp,LOWER(currency) AS currency,SUM(total_cents) AS cents FROM store_orders WHERE app_id=? AND seller_user_id=? AND mode=? AND created_at>=? AND created_at<? AND (created_at>=? OR created_at<?) AND payment_status IN ('paid','partially_refunded','refunded') GROUP BY stamp,LOWER(currency)",
			)
			.bind(appId, ownerId, mode, priorStart, until, start, priorUntil)
			.all<SaleHour>(),
		attributed('device'),
		attributed('source'),
		breakdown('country', recentStart),
		db
			.prepare(
				`SELECT id,path,country,device,source,created_at AS createdAt FROM store_page_events WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT 51`,
			)
			.bind(appId, mode, recentStart, until)
			.all<EventRow>(),
	]);
	const trafficByHour = new Map(
		traffic.results.map((row) => [row.stamp, row.views]),
	);
	const hours = Array.from({ length: 24 }, (_, hour) => ({
		hour,
		pageViews: trafficByHour.get(start + hour * 3600) ?? 0,
		previousPageViews: trafficByHour.get(priorStart + hour * 3600) ?? 0,
	}));
	const currencies = [
		...new Set(sales.results.map((row) => row.currency)),
	].sort();
	return {
		appId,
		mode,
		source: 'cloudflare-store-gateway',
		generatedAt: new Date(now).toISOString(),
		refreshAfterMs: 5000,
		activeVisitors: active?.visitors ?? 0,
		today: today ?? { pageViews: 0, visitors: 0 },
		yesterday: yesterday ?? { pageViews: 0, visitors: 0 },
		hours,
		sales: currencies.map((currency) => {
			const rows = new Map(
				sales.results
					.filter((row) => row.currency === currency)
					.map((row) => [row.stamp, row.cents]),
			);
			const hours = Array.from({ length: 24 }, (_, hour) => ({
				hour,
				cents: rows.get(start + hour * 3600) ?? 0,
				previousCents: rows.get(priorStart + hour * 3600) ?? 0,
			}));
			return {
				currency,
				hours,
				todayCents: hours.reduce((sum, row) => sum + row.cents, 0),
				yesterdayCents: hours.reduce(
					(sum, row) => sum + row.previousCents,
					0,
				),
			};
		}),
		devices,
		sources,
		countries,
		events: events.results.slice(0, 50).map((row) => ({
			...row,
			kind: 'page_view',
			createdAt: new Date(row.createdAt * 1000).toISOString(),
		})),
		hasMoreEvents: events.results.length > 50,
		estimatedVisitors: true,
	};
}
