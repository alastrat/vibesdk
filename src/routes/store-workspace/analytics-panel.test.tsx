import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('./deployed-analytics', () => ({ DeployedStoreAnalytics: () => null }));
import type { SellerOrderRow } from '@/api-types';
import { aggregateOrders, reportingWindow } from './report';
import { AnalyticsPanel } from './analytics-panel';
import { analyticsCsv, comparisonChange } from './analytics-export';
const row: SellerOrderRow = {
	id: 'a',
	orderNumber: 1,
	appId: 'a',
	storeTitle: 'Sample',
	mode: 'test',
	createdAt: '2026-10-24T12:00:00Z',
	customerName: 'Sample',
	customerEmail: 'sample@example.test',
	totalCents: 2400,
	paymentStatus: 'paid',
	fulfillmentStatus: 'fulfilled',
	units: 2,
	ownUnits: 2,
	catalogUnits: 0,
};
describe('analytics comparisons and export', () => {
	it('does not present infinite growth when there is no comparison baseline', () => {
		expect(comparisonChange(500, 0)).toBeNull();
		expect(comparisonChange(0, 0)).toBeNull();
		expect(comparisonChange(150, 100)).toBe(0.5);
		expect(comparisonChange(0, 100)).toBe(-1);
	});
	it('renders the populated metric grid without the old header banner', () => {
		const report = aggregateOrders(
			[row],
			'a',
			reportingWindow(7, '2026-10-24'),
			'test',
		);
		const html = renderToStaticMarkup(
			<AnalyticsPanel
				report={report}
				previous={aggregateOrders(
					[],
					'a',
					reportingWindow(7, '2026-10-17'),
					'test',
				)}
				mode="test"
				appId="a"
				userId="owner"
			/>,
		);
		for (const label of [
			'Refund rate',
			'Dispute rate',
			'Sales by weekday',
			'Top customers',
			'Fulfillment overview',
		])
			expect(html).toContain(label);
		expect(html).not.toContain('ea-test-notice');
	});
	it('exports the displayed test period as daily aggregates without shopper identities', () => {
		const report = aggregateOrders(
			[row, { ...row, id: 'b', mode: 'live', totalCents: 999999 }],
			'a',
			reportingWindow(7, '2026-10-24'),
			'test',
		);
		const csv = analyticsCsv(report);
		expect(csv).toContain('"2026-10-24","24.00","1","1","2","0","0"');
		expect(csv).not.toContain('sample@example.test');
		expect(csv).not.toContain('9999.99');
		expect(csv.split('\r\n').filter(Boolean)).toHaveLength(8);
	});
});
