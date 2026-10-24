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
