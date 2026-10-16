/** Refunds of store order lines, by the seller or by Estori, and the order's refund total they add up to. */

import { and, eq } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { StoreOrderService } from './StoreOrderService';
import type { StoreRefundInitiator } from '../../../shared/types/store-payments';

export class StoreRefundService extends BaseService {
	async record(entry: { refundId: string; orderId: string; lineNo: number; amountCents: number; requestId: string; initiatedBy: StoreRefundInitiator; now: Date }): Promise<void> {
		await this.database
			.insert(schema.storeRefunds)
			.values({ id: entry.refundId, orderId: entry.orderId, lineNo: entry.lineNo, amountCents: entry.amountCents, requestId: entry.requestId, initiatedBy: entry.initiatedBy, createdAt: entry.now })
			.onConflictDoNothing()
			.run();
	}

	async refundedLines(orderId: string): Promise<Set<number>> {
		const rows = await this.database.selectDistinct({ lineNo: schema.storeRefunds.lineNo }).from(schema.storeRefunds).where(eq(schema.storeRefunds.orderId, orderId)).all();
		return new Set(rows.map((row) => row.lineNo));
	}

	/** A catalog item the runner refunded, recorded on its store order line: found by the Checkout session and catalog variant. */
	async recordForCatalogItem(entry: { checkoutSessionId: string; catalogVariantId: string; refundId: string; amountCents: number; now: Date }): Promise<void> {
		const line = await this.database
			.select({ orderId: schema.storeOrderItems.orderId, lineNo: schema.storeOrderItems.lineNo })
			.from(schema.storeOrderItems)
			.innerJoin(schema.storeOrders, eq(schema.storeOrders.id, schema.storeOrderItems.orderId))
			.where(and(eq(schema.storeOrders.stripeCheckoutSessionId, entry.checkoutSessionId), eq(schema.storeOrderItems.catalogVariantId, entry.catalogVariantId)))
			.get();
		if (!line) return;
		await this.record({ refundId: entry.refundId, orderId: line.orderId, lineNo: line.lineNo, amountCents: entry.amountCents, requestId: `catalog-${entry.refundId}`, initiatedBy: 'estori', now: entry.now });
		await new StoreOrderService(this.env).applyRefunds(line.orderId, entry.now);
	}
}
