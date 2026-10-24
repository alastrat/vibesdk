import type {
	StoreTrafficAnalytics,
	StoreTrafficBucket,
	StoreTrafficBreakdown,
	StoreTrafficEvent,
} from '../../../shared/types/store-analytics';

const DAY = 86400;
export const STORE_TRAFFIC_RETENTION_DAYS = 180;
type Mode = 'live' | 'test';
type TrafficEnvironment = Pick<Env, 'DB' | 'JWT_SECRET'>;
interface PageEvent {
	id: string;
	appId: string;
	mode: Mode;
	visitorHash: string;
	path: string;
	source: string;
	country: string;
	device: 'desktop' | 'mobile' | 'tablet';
	createdAt: number;
}
export class StoreAnalyticsAccessError extends Error {
	constructor() {
		super('Store not found');
		this.name = 'StoreAnalyticsAccessError';
	}
}
const BOT =
	/bot\b|crawler|spider|headless|lighthouse|slurp|facebookexternalhit|preview|curl\/|wget\//i;
const ASSET =
	/\.(?:js|mjs|css|map|json|xml|txt|ico|png|jpe?g|gif|webp|avif|svg|woff2?|ttf|otf|pdf|zip|mp[34]|webm|wav)$/i;
function publicPath(pathname: string): string {
	return (
		pathname
			.split('/')
			.map((segment) => {
				let decoded: string;
				try {
					decoded = decodeURIComponent(segment);
				} catch {
					return '[redacted]';
				}
				if (
					decoded.includes('@') ||
					Array.from(decoded).some(
						(character) =>
							character.charCodeAt(0) < 32 ||
							character.charCodeAt(0) === 127,
					) ||
					/^[a-f\d-]{24,}$/i.test(decoded) ||
					decoded.length > 64 ||
					/^(?:eyJ|sk_|pk_|cs_|pi_)/.test(decoded)
				)
					return '[redacted]';
				return segment;
			})
			.join('/')
			.slice(0, 200) || '/'
	);
}
/** Only a successful top-level document request can create an event; reads no response body. */
export async function pageEventOf(
	request: Request,
	response: Response,
	appId: string,
	secret: string,
	now = Date.now(),
): Promise<PageEvent | null> {
	const headers = request.headers;
	const ip = headers.get('CF-Connecting-IP')?.trim();
	const ua = headers.get('User-Agent') ?? '';
	const url = new URL(request.url);
	const dest = headers.get('Sec-Fetch-Dest');
	const fetchMode = headers.get('Sec-Fetch-Mode');
	const botManagement = request.cf?.botManagement;
	const verifiedBot =
		typeof botManagement === 'object' &&
		botManagement !== null &&
		'verifiedBot' in botManagement &&
		botManagement.verifiedBot === true;
	let decodedPath: string;
	try {
		decodedPath = decodeURIComponent(url.pathname);
	} catch {
		return null;
	}
	if (
		request.method !== 'GET' ||
		response.status < 200 ||
		response.status >= 300 ||
		!/^text\/html(?:;|$)/i.test(
			response.headers.get('Content-Type') ?? '',
		) ||
		!ip ||
		!ua ||
		!secret ||
		headers.get('DNT') === '1' ||
		headers.get('Sec-GPC') === '1' ||
		BOT.test(ua) ||
		verifiedBot ||
		(dest !== null && dest !== 'document') ||
		(fetchMode !== null && fetchMode !== 'navigate') ||
		(dest === null && !headers.get('Accept')?.includes('text/html')) ||
		/prefetch|prerender/i.test(
			`${headers.get('Purpose') ?? ''} ${headers.get('Sec-Purpose') ?? ''}`,
		) ||
		/^\/(?:__|assets(?:\/|$)|api(?:\/|$))/i.test(decodedPath) ||
		ASSET.test(decodedPath)
	)
		return null;
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const digest = await crypto.subtle.sign(
		'HMAC',
		key,
		new TextEncoder().encode(
			JSON.stringify(['store-traffic-v1', appId, ip, ua.slice(0, 1024)]),
		),
	);
	const visitorHash = Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, '0'),
	).join('');
	let source = 'Direct';
	try {
		const referrer = new URL(headers.get('Referer') ?? '');
		if (
			['http:', 'https:'].includes(referrer.protocol) &&
			referrer.hostname !== url.hostname
		)
			source = referrer.hostname.toLowerCase().slice(0, 253);
	} catch {
		/* No valid external referrer. */
	}
	const country =
		typeof request.cf?.country === 'string' &&
		/^[A-Z]{2}$/.test(request.cf.country) &&
		!['XX', 'T1'].includes(request.cf.country)
			? request.cf.country
			: 'Unknown';
	const device = /ipad|tablet|android(?!.*mobile)/i.test(ua)
		? 'tablet'
		: /mobile|iphone|ipod/i.test(ua)
			? 'mobile'
			: 'desktop';
	return {
		id: crypto.randomUUID(),
		appId,
		mode: 'live',
		visitorHash,
		path: publicPath(url.pathname),
		source,
		country,
		device,
		createdAt: Math.floor(now / 1000),
	};
}
/** The caller attaches this promise to waitUntil and catches failures so analytics cannot break a page. */
export async function collectStorePage(
	request: Request,
	response: Response,
	env: TrafficEnvironment,
	appId: string,
	now = Date.now(),
): Promise<void> {
	const event = await pageEventOf(
		request,
		response,
		appId,
		env.JWT_SECRET,
		now,
	);
	if (!event) return;
	await env.DB.batch([
		env.DB.prepare(
			'INSERT INTO store_page_events (id,app_id,mode,visitor_hash,path,source,country,device,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
		).bind(
			event.id,
			event.appId,
			event.mode,
			event.visitorHash,
			event.path,
			event.source,
			event.country,
			event.device,
			event.createdAt,
		),
		env.DB.prepare(
			'DELETE FROM store_page_events WHERE created_at < ?',
		).bind(Math.floor(now / 1000) - STORE_TRAFFIC_RETENTION_DAYS * DAY),
	]);
}
interface TrafficRow {
	date: string;
	pageViews: number;
	visitors: number;
}
interface CheckoutRow {
	date: string;
	checkoutStarts: number;
}
interface EventRow {
	id: string;
	path: string;
	country: string;
	device: string;
	source: string;
	createdAt: number;
}
/** Owner and mode checks are repeated here so callers cannot accidentally report another store's data. */
export async function aggregateStoreAnalytics(
	db: D1Database,
	appId: string,
	ownerId: string,
	days: number,
	mode: Mode,
	now = Date.now(),
): Promise<StoreTrafficAnalytics> {
	if (
		!Number.isInteger(days) ||
		days < 1 ||
		days > 90 ||
		!['live', 'test'].includes(mode) ||
		!Number.isFinite(now)
	)
		throw new Error('Invalid reporting period or mode');
	const owner = await db
		.prepare('SELECT id FROM apps WHERE id=? AND user_id=?')
		.bind(appId, ownerId)
		.first<{ id: string }>();
	if (!owner) throw new StoreAnalyticsAccessError();
	const end = (Math.floor(now / 1000 / DAY) + 1) * DAY;
	const start = end - days * DAY;
	const previousStart = start - days * DAY;
	const eventsWhere =
		'app_id=? AND mode=? AND created_at>=? AND created_at<?';
	const eventValues = [appId, mode, start, end];
	const financialWhere =
		'app_id=? AND seller_user_id=? AND mode=? AND created_at>=? AND created_at<?';
	const financialValues = [appId, ownerId, mode, start, end];
	const breakdown = async (
		column: 'source' | 'device' | 'country' | 'path',
	): Promise<StoreTrafficBreakdown[]> =>
		(
			await db
				.prepare(
					`SELECT ${column} AS name,COUNT(*) AS views,COUNT(DISTINCT visitor_hash) AS visitors FROM store_page_events WHERE ${eventsWhere} GROUP BY ${column} ORDER BY views DESC,name ASC LIMIT 10`,
				)
				.bind(...eventValues)
				.all<StoreTrafficBreakdown>()
		).results;
	const [
		totals,
		traffic,
		checkouts,
		abandoned,
		refunds,
		sources,
		devices,
		countries,
		pages,
		events,
		first,
	] = await Promise.all([
		db
			.prepare(
				`SELECT COUNT(*) AS pageViews,COUNT(DISTINCT visitor_hash) AS visitors FROM store_page_events WHERE ${eventsWhere}`,
			)
			.bind(...eventValues)
			.first<{ pageViews: number; visitors: number }>(),
		db
			.prepare(
				`SELECT date(created_at,'unixepoch') AS date,COUNT(*) AS pageViews,COUNT(DISTINCT visitor_hash) AS visitors FROM store_page_events WHERE ${eventsWhere} GROUP BY date`,
			)
			.bind(appId, mode, previousStart, end)
			.all<TrafficRow>(),
		db
			.prepare(
				`SELECT date(created_at,'unixepoch') AS date,COUNT(*) AS checkoutStarts FROM store_checkouts WHERE ${financialWhere} AND status IN ('open','completed','expired') GROUP BY date`,
			)
			.bind(appId, ownerId, mode, previousStart, end)
			.all<CheckoutRow>(),
		db
			.prepare(
				`SELECT COUNT(*) AS count FROM store_checkouts WHERE ${financialWhere} AND status IN ('open','expired') AND created_at<?`,
			)
			.bind(...financialValues, Math.floor(now / 1000) - 1800)
			.first<{ count: number }>(),
		db
			.prepare(
				`SELECT COALESCE(SUM(refunded_cents),0) AS cents FROM store_orders WHERE ${financialWhere}`,
			)
			.bind(...financialValues)
			.first<{ cents: number }>(),
		breakdown('source'),
		breakdown('device'),
		breakdown('country'),
		breakdown('path'),
		db
			.prepare(
				`SELECT id,path,country,device,source,created_at AS createdAt FROM store_page_events WHERE ${eventsWhere} ORDER BY created_at DESC,id DESC LIMIT 20`,
			)
			.bind(...eventValues)
			.all<EventRow>(),
		db
			.prepare(
				'SELECT MIN(created_at) AS first FROM store_page_events WHERE app_id=? AND mode=? AND created_at>=?',
			)
			.bind(
				appId,
				mode,
				Math.floor(now / 1000) - STORE_TRAFFIC_RETENTION_DAYS * DAY,
			)
			.first<{ first: number | null }>(),
	]);
	const trafficDays = new Map(traffic.results.map((row) => [row.date, row]));
	const checkoutDays = new Map(
		checkouts.results.map((row) => [row.date, row.checkoutStarts]),
	);
	const window = (from: number): StoreTrafficBucket[] =>
		Array.from({ length: days }, (_, index) => {
			const date = new Date((from + index * DAY) * 1000)
				.toISOString()
				.slice(0, 10);
			const row = trafficDays.get(date);
			return {
				date,
				pageViews: row?.pageViews ?? 0,
				visitors: row?.visitors ?? 0,
				checkoutStarts: checkoutDays.get(date) ?? 0,
			};
		});
	const trend = window(start);
	return {
		appId,
		mode,
		days,
		source: 'cloudflare-store-gateway',
		trackingSince:
			first?.first != null
				? new Date(first.first * 1000).toISOString()
				: null,
		totals: {
			pageViews: totals?.pageViews ?? 0,
			visitors: totals?.visitors ?? 0,
			checkoutStarts: trend.reduce(
				(sum, day) => sum + day.checkoutStarts,
				0,
			),
			abandonedCheckouts: abandoned?.count ?? 0,
			totalRefundedCents: refunds?.cents ?? 0,
		},
		trend,
		previous: window(previousStart),
		sources,
		devices,
		countries,
		pages,
		events: events.results.map(
			(event): StoreTrafficEvent => ({
				...event,
				kind: 'page_view',
				createdAt: new Date(event.createdAt * 1000).toISOString(),
			}),
		),
		estimatedVisitors: true,
	};
}
