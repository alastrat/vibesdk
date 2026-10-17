/** What a CJ order's current state means for its catalog items. The runner reads CJ and applies these. */

import type { SupplierUpdate } from '../supplier';
import type { CjOrderDetail } from './types';

const CARRIERS: ReadonlyArray<readonly [RegExp, string]> = [
	[/\busps\b/i, 'USPS'],
	[/\bups\b/i, 'UPS'],
	[/\bfedex\b/i, 'FedEx'],
	[/\bdhl\b/i, 'DHL'],
];

/** A last-mile carrier the shopper can track, or "Standard shipping": never the supplier's channel name. */
export function carrierText(provider: string | null, logisticName: string | null): string {
	const text = `${provider ?? ''} ${logisticName ?? ''}`;
	return CARRIERS.find(([pattern]) => pattern.test(text))?.[1] ?? 'Standard shipping';
}

export function cjOrderToUpdates(order: CjOrderDetail): SupplierUpdate[] {
	if (order.orderStatus === 'CANCELLED') {
		return [{ kind: 'cancelled', supplierOrderId: order.orderId, supplierVariantIds: [], reason: 'Cancelled by the supplier' }];
	}
	const updates: SupplierUpdate[] = [];
	if (order.trackNumber) {
		updates.push({ kind: 'shipped', supplierOrderId: order.orderId, trackingNumber: order.trackNumber, carrier: carrierText(order.trackingProvider, order.logisticName) });
	}
	if (order.orderStatus === 'DELIVERED') updates.push({ kind: 'delivered', supplierOrderId: order.orderId });
	return updates;
}
