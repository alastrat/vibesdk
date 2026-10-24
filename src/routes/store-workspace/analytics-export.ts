import { t } from '@/lib/i18n';
import { storeListCsv } from '@/routes/apps/store-list-export';
import type { aggregateOrders } from './report';
type Report = ReturnType<typeof aggregateOrders>;
export function comparisonChange(
	current: number,
	previous: number,
): number | null {
	return previous === 0 ? null : (current - previous) / Math.abs(previous);
}
export function analyticsCsv(report: Report) {
	return storeListCsv(
		[
			t('Date (UTC)'),
			t('Paid order totals'),
			t('Paid orders'),
			t('Total orders'),
			t('Items ordered'),
			t('Refunded orders'),
			t('Disputed orders'),
		],
		report.trend.map((day) => [
			day.date,
			(day.paidCents / 100).toFixed(2),
			String(day.paidOrders),
			String(day.orders),
			String(day.units),
			String(day.refundedOrders),
			String(day.disputedOrders),
		]),
	);
}
