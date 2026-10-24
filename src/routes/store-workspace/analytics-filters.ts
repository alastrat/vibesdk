import type { SellerOrderRow } from '@/api-types';
import { isAnalyticsDay } from 'shared/types/store-analytics';
const DAY = 86400000;
export type AnalyticsPeriod = {
	preset: string;
	days: number;
	from: string;
	to: string;
};
export function customPeriod(
	from: string,
	to: string,
	today: string,
): AnalyticsPeriod | null {
	if (!isAnalyticsDay(from) || !isAnalyticsDay(to) || to > today || from > to)
		return null;
	const days = (Date.parse(to) - Date.parse(from)) / DAY + 1;
	return days <= 90 ? { preset: 'custom', days, from, to } : null;
}
export function analyticsPeriod(
	params: URLSearchParams,
	today = new Date().toISOString().slice(0, 10),
): AnalyticsPeriod {
	const preset = params.get('period') ?? params.get('days') ?? '30';
	if (preset === 'custom') {
		const custom = customPeriod(
			params.get('from') ?? '',
			params.get('to') ?? '',
			today,
		);
		if (custom) return custom;
	}
	const days =
		preset === 'today' || preset === 'yesterday'
			? 1
			: ['7', '30', '90'].includes(preset)
				? Number(preset)
				: 30;
	const to =
		preset === 'yesterday'
			? new Date(Date.parse(today) - DAY).toISOString().slice(0, 10)
			: today;
	return {
		preset:
			preset === 'today' || preset === 'yesterday'
				? preset
				: String(days),
		days,
		to,
		from: new Date(Date.parse(to) - (days - 1) * DAY)
			.toISOString()
			.slice(0, 10),
	};
}
/** Whole orders containing a product, never product-attributed revenue. */
export function ordersForProduct(rows: SellerOrderRow[], productId: string) {
	return productId
		? rows.filter((row) =>
				row.products?.some((product) => product.id === productId),
			)
		: rows;
}
export function productOptions(
	rows: SellerOrderRow[],
	published: { id: string; name: string }[] = [],
) {
	const products = new Map<string, { id: string; name: string }>();
	for (const row of rows)
		for (const product of row.products ?? [])
			if (!products.has(product.id)) products.set(product.id, product);
	for (const product of published)
		products.set(product.id, { id: product.id, name: product.name });
	return [...products.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export const ANALYTICS_WIDGETS = [
	'overview',
	'traffic',
	'metrics',
	'activity',
	'breakdowns',
] as const;
export type AnalyticsWidget = (typeof ANALYTICS_WIDGETS)[number];
