/** An in-memory CatalogOrderStore for tests, honoring the one-order-per-session rule. */

import type { CatalogOrderRow, CatalogOrderStore } from './store';

export function memoryCatalogStore(): CatalogOrderStore & { orders: Map<string, CatalogOrderRow & { lastError: string | null }> } {
	const orders = new Map<string, CatalogOrderRow & { lastError: string | null }>();
	const sessions = new Set<string>();
	return {
		orders,
		async insertPaidOrder(order) {
			if (sessions.has(order.checkoutSessionId)) return false;
			sessions.add(order.checkoutSessionId);
			orders.set(order.id, {
				id: order.id,
				status: 'awaiting-placement',
				paymentIntentId: order.paymentIntentId,
				placementAttempts: 0,
				shippingAddress: order.shippingAddress,
				lastError: null,
				items: order.items.map((item) => ({ ...item, status: 'pending', supplierOrderId: null, trackingNumber: null, carrier: null, supplierRefunded: false, sellerReversalDueCents: 0 })),
			});
			return true;
		},
		async getOrder(orderId) {
			return orders.get(orderId) ?? null;
		},
		async patchItems(patches) {
			for (const order of orders.values()) {
				order.items = order.items.map((item) => {
					const patch = patches.find((candidate) => candidate.itemId === item.id);
					if (!patch) return item;
					const { itemId: _itemId, ...fields } = patch;
					return { ...item, ...fields };
				});
			}
		},
		async updateOrder(orderId, update) {
			const order = orders.get(orderId);
			if (order) orders.set(orderId, { ...order, ...update });
		},
	};
}
