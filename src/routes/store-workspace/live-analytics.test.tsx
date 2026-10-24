import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { StoreLiveAnalytics } from '@/api-types';
import { queryKeys } from '@/lib/query-keys';
import { LiveStoreAnalytics } from './live-analytics';
const snapshot: StoreLiveAnalytics = {
	appId: 'store-a',
	mode: 'test',
	source: 'cloudflare-store-gateway',
	generatedAt: new Date().toISOString(),
	refreshAfterMs: 5000,
	activeVisitors: 1,
	today: { pageViews: 3, visitors: 1 },
	yesterday: { pageViews: 1, visitors: 1 },
	hours: Array.from({ length: 24 }, (_, hour) => ({
		hour,
		pageViews: hour === 0 ? 3 : 0,
		previousPageViews: hour === 0 ? 1 : 0,
	})),
	sales: [],
	devices: [{ name: 'desktop', views: 3, visitors: 1 }],
	sources: [{ name: 'Direct', views: 3, visitors: 1 }],
	countries: [{ name: 'CO', views: 1, visitors: 1 }],
	events: [
		{
			id: 'visit',
			kind: 'page_view',
			path: '/coffee',
			country: 'CO',
			device: 'desktop',
			source: 'Direct',
			createdAt: new Date().toISOString(),
		},
	],
	hasMoreEvents: false,
	estimatedVisitors: true,
};
function render(data: StoreLiveAnalytics = snapshot, userId = 'owner') {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	client.setQueryData(
		queryKeys.account.storeLiveAnalytics('owner', 'store-a', 'test'),
		data,
	);
	const html = renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<MemoryRouter
				initialEntries={[
					'/stores/store-a?section=analytics&view=live&mode=test&period=custom&from=2026-10-01&to=2026-10-10',
				]}
			>
				<LiveStoreAnalytics
					appId="store-a"
					userId={userId}
					mode="test"
				/>
			</MemoryRouter>
		</QueryClientProvider>,
	);
	client.clear();
	return html;
}
describe('live analytics view', () => {
	it('shows the dedicated reference widgets and recorded events, retaining return filters', () => {
		const html = render();
		for (const text of [
			'Today&#x27;s Sales',
			'Today&#x27;s Page Views',
			'Devices',
			'Top sources',
			'Live events',
			'/coffee',
			'Colombia',
			'Test data',
		])
			expect(html).toContain(text);
		expect(html).toContain(
			'href="/stores/store-a?section=analytics&amp;mode=test&amp;period=custom&amp;from=2026-10-01&amp;to=2026-10-10"',
		);
		expect(html).not.toContain('NaN');
	});
	it('does not show pins or invented events for an empty live snapshot', () => {
		const html = render({
			...snapshot,
			events: [],
			countries: [],
			devices: [],
			sources: [],
			activeVisitors: 0,
			today: { pageViews: 0, visitors: 0 },
		});
		expect(html).toContain('Waiting for visitors…');
		expect(html).not.toContain('data-country=');
	});
	it('never reuses a different owner’s cache snapshot', () => {
		const html = render(snapshot, 'other');
		expect(html).not.toContain('/coffee');
		expect(html).toContain('Loading storefront analytics…');
	});
});
