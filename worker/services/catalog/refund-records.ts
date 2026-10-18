/**
 * D1 wiring for what a catalog refund records: the refund on its store order line, and a charge on the seller's later
 * sales for the share their transfer could no longer cover.
 */

import { CatalogOrderService, SellerChargeService, StoreRefundService } from '../../database';
import type { ShopperEmailEvent } from '../shopper-emails/outbox';
import { shopperEmailQueueFromEnv } from '../shopper-emails/wiring';
import type { RefundItemsDeps } from './refund-items';

/**
 * `requestId` is the seller's refund request, or null when Estori started the refund. A refund Estori started emails
 * the shopper here; a seller's refund emails them once for the whole request instead.
 */
export function catalogRefundRecords(
	env: Env,
	requestId: string | null,
	queueShopperEmail: (event: ShopperEmailEvent) => Promise<void> = shopperEmailQueueFromEnv(env),
): Pick<RefundItemsDeps, 'recordRefund' | 'addShortfall'> {
	const catalog = new CatalogOrderService(env);
	return {
		recordRefund: async (entry) => {
			const located = await catalog.locateItem(entry.catalogItemId);
			if (!located) return;
			const line = await new StoreRefundService(env).recordForCatalogItem({
				checkoutSessionId: located.checkoutSessionId,
				catalogVariantId: located.catalogVariantId,
				refundId: entry.refundId,
				amountCents: entry.amountCents,
				initiatedBy: entry.reason === 'seller-refund' ? 'seller' : 'estori',
				requestId,
				now: new Date(),
			});
			if (line && entry.reason !== 'seller-refund') {
				await queueShopperEmail({ orderId: line.orderId, kind: 'refund_issued', eventKey: `catalog:${entry.refundId}`, payload: { lineNos: [line.lineNo], amountCents: entry.amountCents } });
			}
		},
		addShortfall: async (shortfall) => {
			const located = await catalog.locateItem(shortfall.catalogItemId);
			if (!located) throw new Error(`Catalog item ${shortfall.catalogItemId} does not exist, so its refund shortfall has no seller to charge`);
			await new SellerChargeService(env).add({ sellerUserId: located.sellerUserId, kind: 'refund-shortfall', sourceId: `catalog-item-${shortfall.catalogItemId}`, amountCents: shortfall.amountCents, now: new Date() });
		},
	};
}
