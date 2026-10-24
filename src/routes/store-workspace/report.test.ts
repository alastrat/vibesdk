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

describe('expanded store analytics', () => {
	it('counts all orders and units while keeping paid value, refunds, disputes and repeat customers distinct', () => {
		const report = aggregateOrders(
			[
				row('sun', {
					createdAt: '2026-10-18T12:00:00Z',
					totalCents: 3000,
					units: 2,
					fulfillmentStatus: 'fulfilled',
				}),
				row('mon', {
					createdAt: '2026-10-19T12:00:00Z',
					totalCents: 5000,
					units: 4,
					paymentStatus: 'partially_refunded',
				}),
				row('tue', {
					createdAt: '2026-10-20T12:00:00Z',
					totalCents: 1000,
					units: 1,
					paymentStatus: 'refunded',
					customerEmail: 'bea@example.test',
					fulfillmentStatus: 'fulfilled',
				}),
				row('wed', {
					createdAt: '2026-10-21T12:00:00Z',
					totalCents: 7000,
					units: 3,
					paymentStatus: 'disputed',
					customerEmail: null,
				}),
				row('thu', {
					createdAt: '2026-10-22T12:00:00Z',
					totalCents: 2000,
					units: 2,
					paymentStatus: 'dispute_lost',
					customerEmail: 'c@example.test',
					fulfillmentStatus: 'fulfilled',
				}),
				row('fri', {
					createdAt: '2026-10-23T12:00:00Z',
					totalCents: 2000,
					units: 1,
					customerEmail: ' ANA@example.test ',
					fulfillmentStatus: 'fulfilled',
				}),
				row('sat', {
					createdAt: '2026-10-24T12:00:00Z',
					totalCents: 1000,
					units: 1,
					customerEmail: 'd@example.test',
					fulfillmentStatus: 'fulfilled',
				}),
			],
			'tea',
			window,
		);
		expect(report).toMatchObject({
			totalOrders: 7,
			orderedCents: 21000,
			paidCents: 6000,
			paidOrders: 3,
			refundedOrders: 2,
			disputedOrders: 2,
			averageOrderCents: 2000,
			units: 14,
			averageItemsPerOrder: 2,
			customerCount: 4,
			repeatCustomers: 1,
			repeatCustomerRate: 0.25,
			fulfilledOrders: 5,
			unfulfilledOrders: 2,
		});
		expect(report.trend[1]).toMatchObject({
			date: '2026-10-19',
			orders: 1,
			orderedCents: 5000,
			units: 4,
			refundedOrders: 1,
			paidCents: 0,
		});
		expect(report.trend[3]).toMatchObject({ orders: 1, disputedOrders: 1 });
		expect(report.weekdays.map((day) => day.weekday)).toEqual([
			0, 1, 2, 3, 4, 5, 6,
		]);
		expect(report.weekdays[0]).toMatchObject({
			orders: 1,
			paidCents: 3000,
			units: 2,
		});
		expect(report.weekdays[1]).toMatchObject({
			orders: 1,
			refundedOrders: 1,
			paidCents: 0,
		});
	});
	it('returns finite zero averages and ratios without orders or identified customers', () => {
		const report = aggregateOrders([], 'tea', window);
		expect(report).toMatchObject({
			totalOrders: 0,
			averageOrderCents: 0,
			averageItemsPerOrder: 0,
			customerCount: 0,
			repeatCustomers: 0,
			repeatCustomerRate: 0,
		});
		expect(
			report.weekdays.every((day) => day.orders === 0 && day.units === 0),
		).toBe(true);
	});
	it('requires explicit test mode and isolates test orders from live orders in either direction', () => {
		const rows = [
			row('real'),
			row('sample', { mode: 'test', totalCents: 9900 }),
			row('other-sample', { mode: 'test', appId: 'other' }),
		];
		expect(aggregateOrders(rows, 'tea', window).paidCents).toBe(1200);
		expect(aggregateOrders(rows, 'tea', window, 'test').paidCents).toBe(
			9900,
		);
	});
	it('compares adjacent periods without counting a boundary order twice', () => {
		const previous = {
			start: window.start - 7 * 86400000,
			end: window.start,
			days: 7,
		};
		const rows = [
			row('previous', {
				mode: 'test',
				createdAt: '2026-10-17T23:59:59Z',
				totalCents: 5000,
			}),
			row('current', {
				mode: 'test',
				createdAt: '2026-10-18T00:00:00Z',
				totalCents: 3000,
			}),
		];
		expect(aggregateOrders(rows, 'tea', previous, 'test').paidCents).toBe(
			5000,
		);
		expect(aggregateOrders(rows, 'tea', window, 'test').paidCents).toBe(
			3000,
		);
	});
	it('preserves the row-level unrefunded own/catalog split independently of total ordered units', () => {
		const report = aggregateOrders(
			[
				row('mix', {
					units: 6,
					ownUnits: 2,
					catalogUnits: 3,
					paymentStatus: 'partially_refunded',
				}),
			],
			'tea',
			window,
		);
		expect(report).toMatchObject({
			units: 6,
			ownUnits: 2,
			catalogUnits: 3,
		});
		expect(report.trend[6]).toMatchObject({
			units: 6,
			ownUnits: 2,
			catalogUnits: 3,
		});
		expect(report.weekdays[6]).toMatchObject({
			units: 6,
			ownUnits: 2,
			catalogUnits: 3,
		});
	});
	it('fetches the API all-modes stream for test mode without returning live orders', async () => {
		const calls: unknown[] = [];
		const rows = await fetchReportOrders(
			'tea',
			window,
			async (filters) => {
				calls.push(filters);
				return {
					orders: [row('real'), row('sample', { mode: 'test' })],
					nextCursor: null,
					stores: [],
					hasTestOrders: true,
				};
			},
			undefined,
			'test',
		);
		expect(calls).toEqual([
			{ store: 'tea', view: 'all', mode: 'all', cursor: null },
		]);
		expect(rows.map((order) => order.id)).toEqual(['sample']);
	});
});
