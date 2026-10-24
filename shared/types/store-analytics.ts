/** Store-owner analytics: Cloudflare-served document requests, never builder previews. */
export interface StoreTrafficBucket {
	date: string;
	pageViews: number;
	visitors: number;
	checkoutStarts: number;
}
export interface StoreTrafficBreakdown {
	name: string;
	views: number;
	visitors: number;
}
export interface StoreTrafficEvent {
	id: string;
	kind: 'page_view';
	path: string;
	country: string;
	device: string;
	source: string;
	createdAt: string;
}
export interface StoreTrafficAnalytics {
	appId: string;
	mode: 'live' | 'test';
	days: number;
	source: 'cloudflare-store-gateway';
	trackingSince: string | null;
	totals: {
		pageViews: number;
		visitors: number;
		checkoutStarts: number;
		abandonedCheckouts: number;
		totalRefundedCents: number;
	};
	trend: StoreTrafficBucket[];
	previous: StoreTrafficBucket[];
	sources: StoreTrafficBreakdown[];
	devices: StoreTrafficBreakdown[];
	countries: StoreTrafficBreakdown[];
	pages: StoreTrafficBreakdown[];
	events: StoreTrafficEvent[];
	/** IP/UA-based anonymous estimates, not authenticated shopper identities. */
	estimatedVisitors: true;
}

/** Exact ISO calendar day; Date.parse alone normalizes impossible dates. */
export function isAnalyticsDay(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const stamp = Date.parse(`${value}T00:00:00Z`);
	return (
		Number.isFinite(stamp) &&
		new Date(stamp).toISOString().slice(0, 10) === value
	);
}

/** Live view is a fresh UTC-day snapshot; recent locations cover the last five minutes. */
export interface StoreLiveAnalytics {
	appId: string;
	mode: 'live' | 'test';
	source: 'cloudflare-store-gateway';
	generatedAt: string;
	refreshAfterMs: number;
	activeVisitors: number;
	today: { pageViews: number; visitors: number };
	/** Yesterday through the same second of day as generatedAt. */
	yesterday: { pageViews: number; visitors: number };
	hours: { hour: number; pageViews: number; previousPageViews: number }[];
	sales: {
		currency: string;
		todayCents: number;
		yesterdayCents: number;
		hours: { hour: number; cents: number; previousCents: number }[];
	}[];
	devices: StoreTrafficBreakdown[];
	sources: StoreTrafficBreakdown[];
	countries: StoreTrafficBreakdown[];
	events: StoreTrafficEvent[];
	hasMoreEvents: boolean;
	estimatedVisitors: true;
}
