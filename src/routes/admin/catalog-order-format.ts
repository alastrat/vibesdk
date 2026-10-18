import type { AdminCatalogOrderDetail, CatalogItemStatus, CatalogOrderStatus } from '@/api-types';

export const ORDER_STATUS_LABELS: Readonly<Record<CatalogOrderStatus, string>> = {
	'awaiting-placement': 'Waiting to be placed',
	'placement-done': 'Placed',
	'needs-attention': 'Stuck',
	'risk-hold': 'Risk hold',
};

export const ORDER_STATUS_BADGES: Readonly<Record<CatalogOrderStatus, 'info' | 'success' | 'error' | 'warning'>> = {
	'awaiting-placement': 'info',
	'placement-done': 'success',
	'needs-attention': 'error',
	'risk-hold': 'warning',
};

export const ITEM_STATUS_LABELS: Readonly<Record<CatalogItemStatus, string>> = {
	pending: 'Pending',
	placed: 'Placed',
	rejected: 'Rejected',
	shipped: 'Shipped',
	delivered: 'Delivered',
	refunded: 'Refunded',
	withheld: 'Held back',
};

/** "2 shipped, 1 placed": counts in the order an item moves through its statuses. */
export function itemProgress(counts: Partial<Record<CatalogItemStatus, number>>): string {
	const order: readonly CatalogItemStatus[] = ['pending', 'placed', 'shipped', 'delivered', 'rejected', 'refunded', 'withheld'];
	const parts = order.filter((status) => (counts[status] ?? 0) > 0).map((status) => `${counts[status]} ${ITEM_STATUS_LABELS[status].toLowerCase()}`);
	return parts.length > 0 ? parts.join(', ') : 'No items';
}

export type CatalogOrderAction = 'sync' | 'retry' | 'release' | 'sandbox';

/** Sync always; Retry for a stuck order; Release for a risk hold; sandbox moves where the supplier's sandbox takes it. */
export function catalogOrderActions(order: Pick<AdminCatalogOrderDetail, 'status' | 'sandbox'>): CatalogOrderAction[] {
	const actions: CatalogOrderAction[] = ['sync'];
	if (order.status === 'needs-attention') actions.push('retry');
	if (order.status === 'risk-hold') actions.push('release');
	if (order.sandbox) actions.push('sandbox');
	return actions;
}

export function stripePaymentUrl(paymentIntentId: string, mode: AdminCatalogOrderDetail['mode']): string {
	return `https://dashboard.stripe.com/${mode === 'test' ? 'test/' : ''}payments/${encodeURIComponent(paymentIntentId)}`;
}
