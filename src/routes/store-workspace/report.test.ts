import { describe, expect, it } from 'vitest';
import type { SellerOrderRow, SellerOrdersData } from '@/api-types';
import { aggregateOrders, fetchReportOrders, reportingWindow } from './report';

const row = (
	id: string,
	patch: Partial<SellerOrderRow> = {},
): SellerOrderRow => ({
	id,
	orderNumber: 1,
	appId: 'tea',
	storeTitle: 'Tea',
	mode: 'live',
	createdAt: '2026-10-24T10:00:00Z',
	customerName: 'Ana',
	customerEmail: 'ana@example.test',
	totalCents: 1200,
	paymentStatus: 'paid',
	fulfillmentStatus: 'unfulfilled',
	units: 1,
	ownUnits: 1,
	catalogUnits: 0,
	...patch,
});
const window = reportingWindow(7, '2026-10-24');

describe('store reporting', () => {
	it('uses UTC calendar days including today and excludes older, future, test, and other-store orders', () => {
		expect(window).toEqual({
			start: Date.parse('2026-10-18T00:00:00Z'),
			end: Date.parse('2026-10-25T00:00:00Z'),
			days: 7,
		});
		const report = aggregateOrders(
			[
				row('start', { createdAt: '2026-10-18T00:00:00Z' }),
				row('today'),
				row('old', { createdAt: '2026-10-17T23:59:59Z' }),
				row('future', { createdAt: '2026-10-25T00:00:00Z' }),
				row('test', { mode: 'test' }),
				row('other', { appId: 'other' }),
			],
			'tea',
			window,
		);
		expect(report.orders.map((order) => order.id)).toEqual([
			'start',
			'today',
		]);
		expect(report.paidCents).toBe(2400);
		expect(report.trend).toHaveLength(7);
		expect(report.trend.map((day) => day.paidCents)).toEqual([
			1200, 0, 0, 0, 0, 0, 1200,
		]);
	});
	it('excludes refunds and disputes from paid totals, deduplicates orders, and groups only known shopper emails', () => {
		const report = aggregateOrders(
			[
				row('one'),
				row('one'),
				row('two', {
					customerEmail: ' ANA@example.test ',
					totalCents: 2300,
				}),
				row('refunded', { paymentStatus: 'refunded' }),
				row('partial', { paymentStatus: 'partially_refunded' }),
				row('disputed', { paymentStatus: 'disputed' }),
				row('lost', { paymentStatus: 'dispute_lost' }),
				row('unknown', {
					customerEmail: null,
					customerName: null,
					totalCents: 500,
				}),
			],
			'tea',
			window,
		);
		expect(report.orders).toHaveLength(7);
		expect(report.paidCents).toBe(4000);
		expect(report.paidOrders).toBe(3);
		expect(report.customers).toHaveLength(1);
		expect(report.customers[0]).toMatchObject({
			email: 'ana@example.test',
			orders: 6,
			paidCents: 3500,
		});
	});
	it('returns zero-filled days and no invented customers for an empty store', () => {
		const report = aggregateOrders([], 'tea', window);
		expect(report.paidCents).toBe(0);
		expect(report.customers).toEqual([]);
		expect(
			report.trend.every(
				(day) => day.paidCents === 0 && day.paidOrders === 0,
			),
		).toBe(true);
	});
	it('loads later pages until the date boundary and keeps the requested store and live mode on every request', async () => {
		const calls: unknown[] = [];
		const pages: SellerOrdersData[] = [
			{
				orders: [row('new')],
				nextCursor: 'second',
				stores: [],
				hasTestOrders: false,
			},
			{
				orders: [
					row('start', { createdAt: '2026-10-18T00:00:00Z' }),
					row('old', { createdAt: '2026-10-17T23:00:00Z' }),
				],
				nextCursor: 'third',
				stores: [],
				hasTestOrders: false,
			},
		];
		const orders = await fetchReportOrders(
			'tea',
			window,
			async (filters) => {
				calls.push(filters);
				return pages[calls.length - 1];
			},
		);
		expect(calls).toEqual([
			{ store: 'tea', mode: 'live', view: 'all', cursor: null },
			{ store: 'tea', mode: 'live', view: 'all', cursor: 'second' },
		]);
		expect(aggregateOrders(orders, 'tea', window).paidCents).toBe(2400);
	});
	it('rejects a failed later page instead of presenting partial totals as complete', async () => {
		let calls = 0;
		await expect(
			fetchReportOrders('tea', window, async () => {
				if (calls++ === 0)
					return {
						orders: [row('new')],
						nextCursor: 'second',
						stores: [],
						hasTestOrders: false,
					};
				throw new Error('offline');
			}),
		).rejects.toThrow('offline');
	});
});
