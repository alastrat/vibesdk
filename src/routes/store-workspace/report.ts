import type { SellerOrderRow, SellerOrdersData } from '@/api-types';
import { t } from '@/lib/i18n';

const DAY = 86_400_000;
export type ReportingWindow = { start: number; end: number; days: number };
export type ReportFilters = {
	store: string;
	mode: 'live';
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
): Promise<SellerOrderRow[]> {
	const orders: SellerOrderRow[] = [];
	const cursors = new Set<string>();
	let cursor: string | null = null;
	do {
		signal?.throwIfAborted();
		const page = await fetchPage({
			store: appId,
			view: 'all',
			mode: 'live',
			cursor,
		});
		signal?.throwIfAborted();
		orders.push(...page.orders);
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
) {
	const unique = new Map<string, SellerOrderRow>();
	for (const row of rows) {
		const createdAt = Date.parse(row.createdAt);
		if (
			row.appId === appId &&
			row.mode === 'live' &&
			createdAt >= window.start &&
			createdAt < window.end
		)
			unique.set(row.id, row);
	}
	const orders = [...unique.values()];
	const trend = Array.from({ length: window.days }, (_, index) => ({
		date: new Date(window.start + index * DAY).toISOString().slice(0, 10),
		paidCents: 0,
		paidOrders: 0,
	}));
	const customers = new Map<string, CustomerSummary>();
	let paidCents = 0;
	let paidOrders = 0;
	for (const order of orders) {
		const paid = order.paymentStatus === 'paid';
		if (paid) {
			paidCents += order.totalCents;
			paidOrders++;
			const day =
				trend[
					Math.floor(
						(Date.parse(order.createdAt) - window.start) / DAY,
					)
				];
			day.paidCents += order.totalCents;
			day.paidOrders++;
		}
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
	return {
		orders,
		paidCents,
		paidOrders,
		trend,
		customers: [...customers.values()].sort(
			(a, b) => Date.parse(b.lastOrder) - Date.parse(a.lastOrder),
		),
	};
}
