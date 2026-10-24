import { describe, expect, it } from 'vitest';
import {
	analyticsPeriod,
	customPeriod,
	ordersForProduct,
	productOptions,
} from './analytics-filters';
import type { SellerOrderRow } from '@/api-types';
const today = '2026-10-24';
const row = (
	id: string,
	products?: { id: string; name: string }[],
): SellerOrderRow => ({
	id,
	products,
	appId: 'a',
	mode: 'test',
	orderNumber: 1,
	storeTitle: 'A',
	createdAt: '2026-10-24T12:00:00Z',
	customerName: null,
	customerEmail: null,
	totalCents: 1500,
	paymentStatus: 'paid',
	fulfillmentStatus: 'unfulfilled',
	units: 3,
	ownUnits: 3,
	catalogUnits: 0,
});
describe('analytics filters', () => {
	it('uses calendar dates for Today and Yesterday', () => {
		expect(
			analyticsPeriod(new URLSearchParams('period=today'), today),
		).toEqual({ preset: 'today', days: 1, from: today, to: today });
		expect(
			analyticsPeriod(new URLSearchParams('period=yesterday'), today),
		).toEqual({
			preset: 'yesterday',
			days: 1,
			from: '2026-10-23',
			to: '2026-10-23',
		});
	});
	it('validates exact inclusive custom ranges, including leap days', () => {
		expect(customPeriod('2024-02-28', '2024-03-01', today)?.days).toBe(3);
		for (const [from, to] of [
			['2026-02-30', today],
			[today, '2026-10-23'],
			['2026-01-01', today],
			[today, '2026-10-25'],
			['bad', today],
		])
			expect(customPeriod(from, to, today)).toBeNull();
		expect(
			analyticsPeriod(
				new URLSearchParams('period=custom&from=bad&to=bad'),
				today,
			).days,
		).toBe(30);
	});
	it('preserves legacy day links and filters mixed orders once by exact product identity', () => {
		expect(analyticsPeriod(new URLSearchParams('days=7'), today)).toEqual({
			preset: '7',
			days: 7,
			from: '2026-10-18',
			to: today,
		});
		const rows = [
			row('one', [
				{ id: 'tea', name: 'Tea' },
				{ id: 'mug', name: 'Mug' },
			]),
			row('two', [{ id: 'tea-bag', name: 'Tea bag' }]),
			row('old'),
		];
		expect(ordersForProduct(rows, 'tea').map((r) => r.id)).toEqual(['one']);
		expect(ordersForProduct(rows, '')).toHaveLength(3);
		expect(
			productOptions([
				...rows,
				row('again', [{ id: 'tea', name: 'Tea' }]),
			]),
		).toHaveLength(3);
	});
	it('includes published products with no orders and prefers their current names', () => {
		const rows = [
			row('a', [
				{ id: 'tea', name: 'Old tea name' },
				{ id: 'retired', name: 'Retired mug' },
			]),
		];
		expect(
			productOptions(rows, [
				{ id: 'tea', name: 'Tea' },
				{ id: 'new', name: 'New coffee' },
			]),
		).toEqual([
			{ id: 'new', name: 'New coffee' },
			{ id: 'retired', name: 'Retired mug' },
			{ id: 'tea', name: 'Tea' },
		]);
	});
});
