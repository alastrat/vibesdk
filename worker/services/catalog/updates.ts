/** A supplier's report on one of its orders, as changes to the matching catalog items. */

import type { CatalogItemStatus } from '../../../shared/types/catalog';
import type { CatalogOrderItemRow, ItemPatch } from './store';
import type { SupplierUpdate } from './supplier';

/** How far an item has come; rejected, refunded and withheld items are closed and never move again. */
const PROGRESS: Readonly<Record<CatalogItemStatus, number>> = { pending: 0, placed: 1, shipped: 2, delivered: 3, rejected: -1, refunded: -1, withheld: -1 };

function namedIn(variantIds: readonly string[], item: CatalogOrderItemRow): boolean {
	return variantIds.length === 0 || variantIds.includes(item.supplierVariantId);
}

export function applySupplierUpdate(items: readonly CatalogOrderItemRow[], update: SupplierUpdate): readonly ItemPatch[] {
	const ours = items.filter((item) => item.supplierOrderId === update.supplierOrderId);
	switch (update.kind) {
		case 'refunded':
			return ours
				.filter((item) => update.supplierVariantIds.includes(item.supplierVariantId) && !item.supplierRefunded)
				.map((item): ItemPatch => ({ itemId: item.id, supplierRefunded: true }));
		case 'cancelled':
			// Only items still on their way can be cancelled; what arrived stays delivered.
			return ours
				.filter((item) => namedIn(update.supplierVariantIds, item) && (item.status === 'placed' || item.status === 'shipped'))
				.map((item): ItemPatch => ({ itemId: item.id, status: 'rejected' }));
		case 'shipped':
			return ours.flatMap((item): ItemPatch[] => {
				if (item.status === 'placed') {
					return [{ itemId: item.id, status: 'shipped', trackingNumber: update.trackingNumber, carrier: update.carrier }];
				}
				// Suppliers reissue tracking when a parcel moves to another carrier.
				if (item.status === 'shipped' && item.trackingNumber !== update.trackingNumber) {
					return [{ itemId: item.id, trackingNumber: update.trackingNumber, carrier: update.carrier }];
				}
				return [];
			});
		case 'delivered':
			return ours
				.filter((item) => PROGRESS[item.status] >= PROGRESS.placed && PROGRESS[item.status] < PROGRESS.delivered)
				.map((item): ItemPatch => ({ itemId: item.id, status: 'delivered' }));
	}
}
