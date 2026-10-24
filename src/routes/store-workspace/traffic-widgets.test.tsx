import { act, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { StoreTrafficAnalytics } from '@/api-types';
import {
	mountElement,
	silenceTestRendererDeprecation,
	textOf,
	unmountAll,
} from '@/test-support/mounted';
import { TrafficWidgets } from './traffic-widgets';

vi.mock('@visx/responsive', () => ({
	ParentSize: ({
		children,
	}: {
		children: (size: { width: number; height: number }) => ReactNode;
	}) => children({ width: 360, height: 288 }),
}));
beforeAll(silenceTestRendererDeprecation);
afterEach(unmountAll);

const data: StoreTrafficAnalytics = {
	appId: 'store-a',
	mode: 'live',
	source: 'cloudflare-store-gateway',
	days: 2,
	trackingSince: '2026-10-23T00:00:00Z',
	estimatedVisitors: true,
	totals: {
		pageViews: 40,
		visitors: 15,
		checkoutStarts: 5,
		abandonedCheckouts: 2,
		totalRefundedCents: 1234,
	},
	trend: [
		{ date: '2026-10-23', pageViews: 20, visitors: 7, checkoutStarts: 2 },
		{ date: '2026-10-24', pageViews: 20, visitors: 8, checkoutStarts: 3 },
	],
	previous: [
		{ date: '2026-10-21', pageViews: 10, visitors: 3, checkoutStarts: 1 },
		{ date: '2026-10-22', pageViews: 12, visitors: 4, checkoutStarts: 2 },
	],
	sources: [
		{ name: 'Direct', views: 30, visitors: 10 },
		{ name: 'google.com', views: 10, visitors: 5 },
	],
	devices: [
		{ name: 'desktop', views: 20, visitors: 7 },
		{ name: 'mobile', views: 20, visitors: 8 },
	],
	countries: [
		{ name: 'US', views: 30, visitors: 10 },
		{ name: 'DE', views: 10, visitors: 5 },
	],
	pages: [
		{ name: '/', views: 30, visitors: 10 },
		{ name: '/products/tea?token=private-token', views: 10, visitors: 5 },
	],
	events: [
		{
			id: 'e1',
			kind: 'page_view',
			path: '/checkout?email=private@example.test',
			country: 'US',
			device: 'mobile',
			source: 'Direct',
			createdAt: '2026-10-24T15:04:00Z',
		},
	],
};

describe('store traffic widgets', () => {
	it('renders observed traffic, actual refund totals, and a paid-customer denominator without request query strings', () => {
		const html = renderToStaticMarkup(
			<TrafficWidgets data={data} paidCents={9000} customerCount={3} />,
		);
		for (const text of [
			'Traffic over time',
			'Traffic sources',
			'Devices',
			'Countries',
			'Top pages',
			'Recent events',
			'United States',
			'Germany',
			'75%',
			'$12.34',
			'$30.00',
			'Abandoned checkouts',
		])
			expect(html).toContain(text);
		expect(html).not.toContain('private-token');
		expect(html).not.toContain('private@example.test');
		expect(html).not.toContain('experiment exposure');
	});

	it('changes the real chart series and prior period when switching traffic metrics', async () => {
		const renderer = await mountElement(
			<TrafficWidgets data={data} paidCents={9000} customerCount={3} />,
		);
		const slider = () => renderer.root.findByProps({ role: 'slider' });
		expect(slider().props['aria-label']).toBe('Estimated visitors');
		expect(slider().props['aria-valuetext']).toContain('UTC: 8');
		const pageViews = renderer.root
			.findAllByType('button')
			.find((button) => button.props['aria-label'] === 'Page views');
		await act(async () => pageViews!.props.onClick());
		expect(slider().props['aria-label']).toBe('Page views');
		expect(slider().props['aria-valuetext']).toContain('UTC: 20');
		expect(slider().props['aria-valuetext']).toContain('UTC: 12');
		const checkouts = renderer.root
			.findAllByType('button')
			.find((button) => button.props['aria-label'] === 'Checkouts');
		await act(async () => checkouts!.props.onClick());
		expect(slider().props['aria-valuetext']).toContain('UTC: 3');
		expect(textOf(renderer)).toContain('Anonymous estimates');
	});

	it('removes and restores the prior series with the dashboard comparison control', async () => {
		const props = { data, paidCents: 9000, customerCount: 3 };
		const renderer = await mountElement(
			<TrafficWidgets {...props} compare />,
		);
		const slider = () => renderer.root.findByProps({ role: 'slider' });
		expect(slider().props['aria-valuetext']).toContain('UTC: 4');
		await act(async () =>
			renderer.update(<TrafficWidgets {...props} compare={false} />),
		);
		expect(slider().props['aria-valuetext']).not.toContain('UTC: 4');
		expect(textOf(renderer)).not.toContain('Previous period');
		await act(async () =>
			renderer.update(<TrafficWidgets {...props} compare />),
		);
		expect(slider().props['aria-valuetext']).toContain('UTC: 4');
		expect(textOf(renderer)).toContain('Previous period');
	});

	it('focuses a recorded country from a visit and filters the event feed', async () => {
		const other = {
			...data.events[0],
			id: 'e2',
			path: '/german-visit',
			country: 'DE',
		};
		const renderer = await mountElement(
			<TrafficWidgets
				data={{ ...data, events: [...data.events, other] }}
				paidCents={9000}
				customerCount={3}
			/>,
		);
		const visit = renderer.root
			.findAllByType('button')
			.find(
				(button) =>
					button.props['aria-label'] === 'United States · /checkout',
			);
		await act(async () => visit!.props.onClick());
		expect(textOf(renderer)).not.toContain('/german-visit');
		expect(textOf(renderer)).toContain('/checkout');
		await act(async () => visit!.props.onClick());
		expect(textOf(renderer)).toContain('/german-visit');
	});

	it('shows empty tracking honestly and keeps test traffic visibly distinct', () => {
		const empty = {
			...data,
			mode: 'test' as const,
			trackingSince: null,
			totals: {
				pageViews: 0,
				visitors: 0,
				checkoutStarts: 0,
				abandonedCheckouts: 0,
				totalRefundedCents: 0,
			},
			trend: [],
			previous: [],
			sources: [],
			devices: [],
			countries: [],
			pages: [],
			events: [],
		};
		const html = renderToStaticMarkup(
			<TrafficWidgets data={empty} paidCents={0} customerCount={0} />,
		);
		expect(html).toContain('Test traffic');
		expect(html).toContain('No traffic recorded in this period.');
		expect(html).toContain('No recent events.');
		expect(html).toContain('No paid customers in this period.');
		expect(html).not.toMatch(/NaN|Infinity/);
	});
});
