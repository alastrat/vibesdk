import { describe, expect, it } from 'vitest';
import { liveStoreView, storeUrl } from './view';

const MANIFEST = JSON.stringify({ version: 1, currency: 'usd', shipping: { countries: ['US'], flatRateCents: 0 }, products: [{ id: 'tea', name: 'Tea', variants: [{ id: 'tea-50', name: '50 g', priceCents: 1200 }] }] });
const BASE = { appId: 'e0dcb2a3-0ea1', title: 'Northwind Tea Co.', storesDomain: 'estori.shop', devPort: null, domainsAvailable: true, record: null, previewCommit: 'c2', publishedManifest: null, domain: null };

describe('the Go live view', () => {
	it('builds https addresses in production, and http ones with the port on a local .localhost domain', () => {
		expect(storeUrl('northwind.estori.shop', null)).toBe('https://northwind.estori.shop');
		expect(storeUrl('northwind.stores.localhost', '8100')).toBe('http://northwind.stores.localhost:8100');
		expect(storeUrl('shop.northwindtea.com', '8100')).toBe('https://shop.northwindtea.com');
	});

	it('suggests an address for a store that was never published', () => {
		expect(liveStoreView(BASE)).toEqual({
			available: true,
			storesDomain: 'estori.shop',
			status: 'unpublished',
			slug: null,
			suggestedSlug: 'northwind-tea-co',
			url: null,
			publishedAt: null,
			hasChanges: true,
			checkoutConnected: false,
			domain: null,
			domainsAvailable: true,
		});
	});

	it('shows the live address, whether the preview has changes, and whether checkout is connected', () => {
		const record = { appId: 'e0dcb2a3-0ea1', slug: 'northwind', status: 'live' as const, publishedCommit: 'c2', publishedAt: new Date(1_800_000_000_000) };
		const view = liveStoreView({ ...BASE, record, publishedManifest: MANIFEST });
		expect(view).toMatchObject({ status: 'live', slug: 'northwind', url: 'https://northwind.estori.shop', hasChanges: false, checkoutConnected: true, publishedAt: '2027-01-15T08:00:00.000Z' });
		expect(liveStoreView({ ...BASE, record, previewCommit: 'c3', publishedManifest: '{}' })).toMatchObject({ hasChanges: true, checkoutConnected: false });
	});

	it("shows the store's domain with its records and its own address", () => {
		const domain = { hostname: 'shop.northwindtea.com', appId: 'e0dcb2a3-0ea1', status: 'pending' as const, provider: 'cloudflare' as const, providerId: 'ch_1', records: [], lastError: null, createdAt: new Date(0), checkedAt: null, verifiedAt: null };
		expect(liveStoreView({ ...BASE, domain }).domain).toEqual({ hostname: 'shop.northwindtea.com', url: 'https://shop.northwindtea.com', status: 'pending', records: [], lastError: null, checkedAt: null, verifiedAt: null });
	});

	it('is unavailable without a stores domain', () => {
		expect(liveStoreView({ ...BASE, storesDomain: null })).toMatchObject({ available: false, storesDomain: null });
	});
});
