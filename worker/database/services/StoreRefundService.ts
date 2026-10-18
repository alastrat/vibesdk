/**
 * Refunds of store order lines, by the seller or by Estori, and the order's refund total they add up to. A line's row is
 * claimed before Stripe is called and filled in as its refund and reversal happen; one row per line, whoever asks.
 */

import { and, eq } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { StoreOrderService } from './StoreOrderService';
import type { StoreRefundInitiator } from '../../../shared/types/store-payments';
import type { StoreRefundRow } from '../../services/store-payments/refund-lines';

const refundRowId = (orderId: string, lineNo: number): string => `sr_${orderId}_${lineNo}`;

const ROW_FIELDS = {
	lineNo: schema.storeRefunds.lineNo,
	requestId: schema.storeRefunds.requestId,
	amountCents: schema.storeRefunds.amountCents,
	reversalCents: schema.storeRefunds.reversalCents,
	stripeRefundId: schema.storeRefunds.stripeRefundId,
	reversalId: schema.storeRefunds.reversalId,
};

export class StoreRefundService extends BaseService {
	async refundRows(orderId: string): Promise<Map<number, StoreRefundRow>> {
		const rows = await this.database.select(ROW_FIELDS).from(schema.storeRefunds).where(eq(schema.storeRefunds.orderId, orderId)).all();
		return new Map(rows.map((row) => [row.lineNo, row]));
	}

	/** Claims a line for a refund, or returns the claim already made for it, possibly by another request. */
	async claimRefund(claim: { orderId: string; lineNo: number; requestId: string; initiatedBy: StoreRefundInitiator; amountCents: number; reversalCents: number; now: Date }): Promise<StoreRefundRow> {
		await this.database
			.insert(schema.storeRefunds)
			.values({
				id: refundRowId(claim.orderId, claim.lineNo),
				orderId: claim.orderId,
				lineNo: claim.lineNo,
				requestId: claim.requestId,
				initiatedBy: claim.initiatedBy,
				amountCents: claim.amountCents,
				reversalCents: claim.reversalCents,
				createdAt: claim.now,
			})
			.onConflictDoNothing()
			.run();
		const row = await this.database
			.select(ROW_FIELDS)
			.from(schema.storeRefunds)
			.where(and(eq(schema.storeRefunds.orderId, claim.orderId), eq(schema.storeRefunds.lineNo, claim.lineNo)))
			.get();
		if (!row) throw new Error(`The refund claim for line ${claim.lineNo} of ${claim.orderId} wasn't stored`);
		return row;
	}

	async completeRefund(done: { orderId: string; lineNo: number; stripeRefundId: string }): Promise<void> {
		await this.database
			.update(schema.storeRefunds)
			.set({ stripeRefundId: done.stripeRefundId })
			.where(and(eq(schema.storeRefunds.orderId, done.orderId), eq(schema.storeRefunds.lineNo, done.lineNo)))
			.run();
	}

	async completeReversal(done: { orderId: string; lineNo: number; reversalId: string }): Promise<void> {
		await this.database
			.update(schema.storeRefunds)
			.set({ reversalId: done.reversalId })
			.where(and(eq(schema.storeRefunds.orderId, done.orderId), eq(schema.storeRefunds.lineNo, done.lineNo)))
			.run();
	}

	/**
	 * A catalog item's refund, recorded on its store order line once it happened: found by the Checkout session and catalog
	 * variant. The catalog item tracks its own reversal, so the line needs none here.
	 */
	async recordForCatalogItem(entry: { checkoutSessionId: string; catalogVariantId: string; refundId: string; amountCents: number; initiatedBy: StoreRefundInitiator; requestId: string | null; now: Date }): Promise<void> {
		const line = await this.database
			.select({ orderId: schema.storeOrderItems.orderId, lineNo: schema.storeOrderItems.lineNo })
			.from(schema.storeOrderItems)
			.innerJoin(schema.storeOrders, eq(schema.storeOrders.id, schema.storeOrderItems.orderId))
			.where(and(eq(schema.storeOrders.stripeCheckoutSessionId, entry.checkoutSessionId), eq(schema.storeOrderItems.catalogVariantId, entry.catalogVariantId)))
			.get();
		if (!line) return;
		await this.database
			.insert(schema.storeRefunds)
			.values({
				id: refundRowId(line.orderId, line.lineNo),
				orderId: line.orderId,
				lineNo: line.lineNo,
				amountCents: entry.amountCents,
				requestId: entry.requestId ?? `catalog-${entry.refundId}`,
				initiatedBy: entry.initiatedBy,
				stripeRefundId: entry.refundId,
				reversalCents: 0,
				createdAt: entry.now,
			})
			.onConflictDoUpdate({ target: [schema.storeRefunds.orderId, schema.storeRefunds.lineNo], set: { stripeRefundId: entry.refundId } })
			.run();
		await new StoreOrderService(this.env).applyRefunds(line.orderId, entry.now);
	}
}
