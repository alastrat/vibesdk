import type { SellerOrderRow, SellerOrdersData } from '@/api-types';
import { t } from '@/lib/i18n';

const DAY = 86_400_000;
export type ReportMode = 'live' | 'test';
export type ReportingWindow = { start: number; end: number; days: number };
export type ReportFilters = {
	store: string;
	mode: 'live' | 'all';
	view: 'all';
	cursor: string | null;
};
export type CustomerSummary = {
	email: string;
	name: string | null;
	orders: number;
	paidCents: number;
	lastOrder: string;
	lastOrderId: string;
};

/** Calendar days in UTC, including the supplied day. End is exclusive. */
export function reportingWindow(
	days: number,
	throughDay: string,
): ReportingWindow {
	const end = Date.parse(`${throughDay}T00:00:00Z`) + DAY;
	return { start: end - days * DAY, end, days };
}

/** The API is ordered by createdAt descending, then id. Never publish partial totals. */
export async function fetchReportOrders(
	appId: string,
	window: ReportingWindow,
	fetchPage: (filters: ReportFilters) => Promise<SellerOrdersData>,
	signal?: AbortSignal,
	mode: ReportMode = 'live',
): Promise<SellerOrderRow[]> {
	const orders: SellerOrderRow[] = [];
	const cursors = new Set<string>();
	let cursor: string | null = null;
	do {
		signal?.throwIfAborted();
		const page = await fetchPage({
			store: appId,
			view: 'all',
			mode: mode === 'test' ? 'all' : 'live',
			cursor,
		});
		signal?.throwIfAborted();
		orders.push(
			...page.orders.filter(
				(order) => order.mode === mode && order.appId === appId,
			),
		);
		if (
			page.orders.some(
				(order) => Date.parse(order.createdAt) < window.start,
			)
		)
			break;
		cursor = page.nextCursor;
		if (cursor && cursors.has(cursor))
			throw new Error(
				t(
					'Could not finish loading this reporting period. Please try again.',
				),
			);
		if (cursor) cursors.add(cursor);
	} while (cursor);
	return orders;
}

export function aggregateOrders(
	rows: SellerOrderRow[],
	appId: string,
	window: ReportingWindow,
	mode: ReportMode = 'live',
) {
	const unique = new Map<string, SellerOrderRow>();
	for (const row of rows) {
		const createdAt = Date.parse(row.createdAt);
		if (
			row.appId === appId &&
			row.mode === mode &&
			createdAt >= window.start &&
			createdAt < window.end
		)
			unique.set(row.id, row);
	}
	const orders = [...unique.values()];
	const trend = Array.from({ length: window.days }, (_, index) => ({
		date: new Date(window.start + index * DAY).toISOString().slice(0, 10),
		...emptyMetrics(),
	}));
	const customers = new Map<string, CustomerSummary>();
	const totals = emptyMetrics();
	const weekdays = Array.from({ length: 7 }, (_, weekday) => ({
		weekday,
		...emptyMetrics(),
	}));
	let fulfilledOrders = 0;
	let unfulfilledOrders = 0;
	for (const order of orders) {
		const paid = order.paymentStatus === 'paid';
		const day =
			trend[
				Math.floor((Date.parse(order.createdAt) - window.start) / DAY)
			];
		const weekday = weekdays[new Date(order.createdAt).getUTCDay()];
		for (const bucket of [totals, day, weekday]) {
			bucket.orders++;
			bucket.orderedCents += order.totalCents;
			bucket.units += order.units;
			bucket.ownUnits += order.ownUnits;
			bucket.catalogUnits += order.catalogUnits;
			if (paid) {
				bucket.paidCents += order.totalCents;
				bucket.paidOrders++;
			}
			if (
				order.paymentStatus === 'refunded' ||
				order.paymentStatus === 'partially_refunded'
			)
				bucket.refundedOrders++;
			if (
				order.paymentStatus === 'disputed' ||
				order.paymentStatus === 'dispute_lost'
			)
				bucket.disputedOrders++;
		}
		if (order.fulfillmentStatus === 'fulfilled') fulfilledOrders++;
		else unfulfilledOrders++;
		const email = order.customerEmail?.trim().toLowerCase();
		if (!email) continue;
		const customer = customers.get(email) ?? {
			email,
			name: order.customerName,
			orders: 0,
			paidCents: 0,
			lastOrder: order.createdAt,
			lastOrderId: order.id,
		};
		customer.orders++;
		if (paid) customer.paidCents += order.totalCents;
		if (Date.parse(order.createdAt) > Date.parse(customer.lastOrder)) {
			customer.lastOrder = order.createdAt;
			customer.lastOrderId = order.id;
			customer.name = order.customerName;
		}
		customers.set(email, customer);
	}
	const customerCount = customers.size;
	const repeatCustomers = [...customers.values()].filter(
		(customer) => customer.orders > 1,
	).length;
	return {
		orders,
		totalOrders: totals.orders,
		orderedCents: totals.orderedCents,
		paidCents: totals.paidCents,
		paidOrders: totals.paidOrders,
		refundedOrders: totals.refundedOrders,
		disputedOrders: totals.disputedOrders,
		averageOrderCents: totals.paidOrders
			? totals.paidCents / totals.paidOrders
			: 0,
		units: totals.units,
		ownUnits: totals.ownUnits,
		catalogUnits: totals.catalogUnits,
		averageItemsPerOrder: totals.orders ? totals.units / totals.orders : 0,
		customerCount,
		repeatCustomers,
		repeatCustomerRate: customerCount ? repeatCustomers / customerCount : 0,
		fulfilledOrders,
		unfulfilledOrders,
		weekdays,
		trend,
		customers: [...customers.values()].sort(
			(a, b) => Date.parse(b.lastOrder) - Date.parse(a.lastOrder),
		),
	};
}

/** Face values and counts only; SellerOrderRow cannot provide net refunds, fees, or payout balances. */
function emptyMetrics() {
	return {
		orders: 0,
		orderedCents: 0,
		paidCents: 0,
		paidOrders: 0,
		refundedOrders: 0,
		disputedOrders: 0,
		units: 0,
		ownUnits: 0,
		catalogUnits: 0,
	};
}
