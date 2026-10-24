/** A store order as its seller sees it on the Orders page. Pure. */

import type { CatalogItemProgress, SellerOrderDetail } from '../../../../shared/types/store-payments';
import type { SellerOrderFacts } from '../../../database/services/SellerOrderService';
import type { StoreOrderView } from '../../../services/store-payments/store';
import { orderSummary } from '../stores/order-summary';

export function sellerOrderDetail(order: StoreOrderView, facts: SellerOrderFacts, catalogItems: CatalogItemProgress[]): SellerOrderDetail {
	const refunded = new Set(facts.refundedLineNos);
	const pending = new Set(facts.pendingRefundLineNos);
	const { items: _items, ...summary } = orderSummary(order, catalogItems);
	return {
		...summary,
		appId: order.appId,
		storeTitle: facts.storeTitle,
		customerPhone: order.shippingAddress?.phone ?? null,
		refundedCents: order.refundedCents,
		carrier: facts.carrier,
		trackingNumber: facts.trackingNumber,
		shippedAt: facts.shippedAt?.toISOString() ?? null,
		dispute: facts.dispute,
		items: order.items.map((item) => ({
			lineNo: item.lineNo,
			...(facts.digitalLineNos?.includes(item.lineNo) ? {productType: 'digital' as const} : {}),
			name: item.name,
			kind: item.kind,
			quantity: item.quantity,
			unitPriceCents: item.unitPriceCents,
			catalogVariantId: item.catalogVariantId,
			refunded: refunded.has(item.lineNo),
			refundPending: pending.has(item.lineNo),
		})),
	};
}
