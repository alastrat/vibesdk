/** D1 reads and writes for store orders and their items. */

import { and, desc, eq, gte, inArray, isNull, lte, max, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import type { NewStoreOrder, NewStoreOrderItem, StoreOrderView } from '../../services/store-payments/store';
import type { ShippingAddress } from '../../services/catalog/supplier';
import type { StoreMode, StorePaymentStatus } from '../../../shared/types/store-payments';
import { COMPLETED_ORDER_MIN_AGE_DAYS, type SellerRecord } from '../../../shared/types/seller-levels';

const NUMBERING_ATTEMPTS = 3;

function uniqueViolation(error: unknown): string | null {
    return error instanceof Error && error.message.includes('UNIQUE constraint failed') ? error.message : null;
}

export class StoreOrderService extends BaseService {
    /** One batch per attempt: the order, its items and its checkout. A second delivery of the same checkout writes nothing. */
    async recordOrder(order: NewStoreOrder): Promise<'recorded' | 'already-recorded'> {
        for (let attempt = 0; attempt < NUMBERING_ATTEMPTS; attempt++) {
            const last = await this.database
                .select({ number: max(schema.storeOrders.orderNumber) })
                .from(schema.storeOrders)
                .where(and(eq(schema.storeOrders.appId, order.appId), eq(schema.storeOrders.mode, order.mode)))
                .get();
            try {
                await this.database.batch([
                    this.database.insert(schema.storeOrders).values({
                        id: order.id,
                        mode: order.mode,
                        appId: order.appId,
                        orderNumber: (last?.number ?? 0) + 1,
                        checkoutId: order.checkoutId,
                        sellerUserId: order.sellerUserId,
                        sellerStripeAccountId: order.sellerStripeAccountId,
                        storeVersionId: order.storeVersionId,
                        stripeCheckoutSessionId: order.stripeCheckoutSessionId,
                        stripePaymentIntentId: order.stripePaymentIntentId,
                        subtotalCents: order.subtotalCents,
                        shippingCents: order.shippingCents,
                        totalCents: order.totalCents,
                        applicationFeeCents: order.applicationFeeCents,
                        customerEmail: order.customerEmail,
                        customerName: order.customerName,
                        shippingAddress: order.shippingAddress ? JSON.stringify(order.shippingAddress) : null,
                        note: order.note,
                        needsAttention: order.needsAttention,
                        createdAt: order.createdAt,
                        updatedAt: order.createdAt,
                    }),
                    // One statement per item: D1 binds at most 100 parameters per statement, and an item takes 10.
                    ...order.items.map((item) => this.database.insert(schema.storeOrderItems).values({ ...item, orderId: order.id })),
                    this.database
                        .update(schema.storeCheckouts)
                        .set({ status: 'completed' })
                        .where(eq(schema.storeCheckouts.id, order.checkoutId)),
                ]);
                return 'recorded';
            } catch (error) {
                const violation = uniqueViolation(error);
                if (!violation) throw error;
                // Another order took this number between the read and the write; read the last number again.
                if (violation.includes('order_number')) continue;
                return 'already-recorded';
            }
        }
        throw new Error(`Could not number the order for checkout ${order.checkoutId}`);
    }

    async getOrder(orderId: string): Promise<StoreOrderView | null> {
        const [order] = await this.ordersWhere(eq(schema.storeOrders.id, orderId), 1);
        return order ?? null;
    }

    async listOrders(appId: string, limit = 50): Promise<StoreOrderView[]> {
        return this.ordersWhere(eq(schema.storeOrders.appId, appId), limit);
    }

    async findByPaymentIntent(paymentIntentId: string): Promise<StoreOrderView | null> {
        const [order] = await this.ordersWhere(eq(schema.storeOrders.stripePaymentIntentId, paymentIntentId), 1);
        return order ?? null;
    }

    /** How many orders the seller's stores have recorded in this mode; 1 right after their first sale. */
    async sellerOrderCount(sellerUserId: string, mode: StoreMode): Promise<number> {
        const row = await this.database
            .select({ count: sql<number>`count(*)` })
            .from(schema.storeOrders)
            .where(and(eq(schema.storeOrders.sellerUserId, sellerUserId), eq(schema.storeOrders.mode, mode)))
            .get();
        return row?.count ?? 0;
    }

    /** The seller's share of their paid sales since this time: what their payouts carry. */
    /** What the seller's paid sales in this mode since `since` paid them, net of Estori's fee and refunds; disputed sales pay nothing. */
    async salesVolumeSince(sellerUserId: string, mode: StoreMode, since: Date): Promise<number> {
        const row = await this.database
            .select({ volume: sql<number>`COALESCE(SUM(${schema.storeOrders.totalCents} - ${schema.storeOrders.applicationFeeCents} - ${schema.storeOrders.refundedCents}), 0)` })
            .from(schema.storeOrders)
            .where(
                and(
                    eq(schema.storeOrders.sellerUserId, sellerUserId),
                    eq(schema.storeOrders.mode, mode),
                    inArray(schema.storeOrders.paymentStatus, ['paid', 'partially_refunded']),
                    gte(schema.storeOrders.createdAt, since),
                ),
            )
            .get();
        return row?.volume ?? 0;
    }

    async setPaymentStatus(orderId: string, status: StorePaymentStatus, now: Date): Promise<void> {
        await this.database
            .update(schema.storeOrders)
            .set({ paymentStatus: status, revision: sql`${schema.storeOrders.revision} + 1`, updatedAt: now })
            .where(eq(schema.storeOrders.id, orderId))
            .run();
    }

    /** Sets the order's refund total and payment status from its recorded refunds; a dispute status is kept. */
    async applyRefunds(orderId: string, now: Date): Promise<void> {
        const refunded = sql`(SELECT COALESCE(SUM(${schema.storeRefunds.amountCents}), 0) FROM ${schema.storeRefunds} WHERE ${schema.storeRefunds.orderId} = ${orderId} AND ${schema.storeRefunds.stripeRefundId} IS NOT NULL)`;
        await this.database
            .update(schema.storeOrders)
            .set({
                refundedCents: refunded,
                paymentStatus: sql`CASE WHEN ${schema.storeOrders.paymentStatus} IN ('disputed', 'dispute_lost') THEN ${schema.storeOrders.paymentStatus} WHEN ${refunded} >= ${schema.storeOrders.totalCents} THEN 'refunded' WHEN ${refunded} > 0 THEN 'partially_refunded' ELSE ${schema.storeOrders.paymentStatus} END`,
                revision: sql`${schema.storeOrders.revision} + 1`,
                updatedAt: now,
            })
            .where(eq(schema.storeOrders.id, orderId))
            .run();
    }

    async feeAdjustment(orderId: string): Promise<{ differenceCents: number; reversalId: string | null } | null> {
        const row = await this.database
            .select({ differenceCents: schema.storeFeeAdjustments.differenceCents, reversalId: schema.storeFeeAdjustments.reversalId })
            .from(schema.storeFeeAdjustments)
            .where(eq(schema.storeFeeAdjustments.orderId, orderId))
            .get();
        return row ?? null;
    }

    /** Saves the fee difference to take back before Stripe is called; a second plan for the order changes nothing. */
    async planFeeAdjustment(plan: { orderId: string; collectedCents: number; actualFeeCents: number; differenceCents: number; now: Date }): Promise<void> {
        await this.database
            .insert(schema.storeFeeAdjustments)
            .values({ orderId: plan.orderId, collectedCents: plan.collectedCents, actualFeeCents: plan.actualFeeCents, differenceCents: plan.differenceCents, reversalId: null, createdAt: plan.now })
            .onConflictDoNothing()
            .run();
    }

    async completeFeeAdjustment(orderId: string, reversalId: string): Promise<void> {
        await this.database.update(schema.storeFeeAdjustments).set({ reversalId }).where(eq(schema.storeFeeAdjustments.orderId, orderId)).run();
    }

    private async ordersWhere(condition: ReturnType<typeof eq>, limit: number): Promise<StoreOrderView[]> {
        const orders = await this.database
            .select()
            .from(schema.storeOrders)
            .where(condition)
            .orderBy(desc(schema.storeOrders.createdAt))
            .limit(limit)
            .all();
        if (orders.length === 0) return [];
        const items = await this.database
            .select()
            .from(schema.storeOrderItems)
            .where(inArray(schema.storeOrderItems.orderId, orders.map((order) => order.id)))
            .all();
        return orders.map((order) => {
            const shippingAddress: ShippingAddress | null = order.shippingAddress ? JSON.parse(order.shippingAddress) : null;
            const lines: NewStoreOrderItem[] = items
                .filter((item) => item.orderId === order.id)
                .sort((a, b) => a.lineNo - b.lineNo)
                .map(({ orderId: _orderId, ...item }) => item);
            return {
                id: order.id,
                orderNumber: order.orderNumber,
                mode: order.mode,
                appId: order.appId,
                paymentStatus: order.paymentStatus,
                fulfillmentStatus: order.fulfillmentStatus,
                subtotalCents: order.subtotalCents,
                shippingCents: order.shippingCents,
                totalCents: order.totalCents,
                applicationFeeCents: order.applicationFeeCents,
                currency: order.currency,
                customerEmail: order.customerEmail,
                customerName: order.customerName,
                shippingAddress,
                note: order.note,
                needsAttention: order.needsAttention,
                stripeCheckoutSessionId: order.stripeCheckoutSessionId,
                stripePaymentIntentId: order.stripePaymentIntentId,
                sellerUserId: order.sellerUserId,
                sellerStripeAccountId: order.sellerStripeAccountId,
                refundedCents: order.refundedCents,
                createdAt: order.createdAt,
                items: lines,
            };
        });
    }

    /** The seller's record in one mode, for their level: first sale, completed orders, and 90 days of orders and chargebacks. */
    async sellerRecord(sellerUserId: string, mode: StoreMode, nowMs: number): Promise<SellerRecord> {
        const orders = schema.storeOrders;
        const mine = and(eq(orders.sellerUserId, sellerUserId), eq(orders.mode, mode));
        const ninetyDaysAgo = new Date(nowMs - 90 * 24 * 60 * 60 * 1000);
        const fourteenDaysAgo = new Date(nowMs - COMPLETED_ORDER_MIN_AGE_DAYS * 24 * 60 * 60 * 1000);
        const first = await this.database.select({ at: sql<number | null>`min(${orders.createdAt})` }).from(orders).where(mine).get();
        const recent = await this.database.select({ count: sql<number>`count(*)` }).from(orders).where(and(mine, gte(orders.createdAt, ninetyDaysAgo))).get();
        // Chargebacks opened in the window, for the rate; losses decided in it, since a dispute can take months to decide.
        // Inquiries take no money and aren't chargebacks, so they don't count.
        const disputes = await this.database
            .select({
                total: sql<number>`COALESCE(sum(case when ${gte(schema.storeDisputes.createdAt, ninetyDaysAgo)} then 1 else 0 end), 0)`,
                lost: sql<number>`COALESCE(sum(case when ${and(eq(schema.storeDisputes.status, 'lost'), gte(schema.storeDisputes.closedAt, ninetyDaysAgo))} then 1 else 0 end), 0)`,
            })
            .from(schema.storeDisputes)
            .innerJoin(orders, eq(orders.id, schema.storeDisputes.orderId))
            .where(and(mine, sql`${schema.storeDisputes.status} NOT LIKE 'warning_%'`))
            .get();
        // Paid, at least COMPLETED_ORDER_MIN_AGE_DAYS old, never disputed (a won dispute returns the order to paid), and every catalog item delivered.
        const completed = await this.database
            .select({ count: sql<number>`count(*)` })
            .from(orders)
            .where(
                and(
                    mine,
                    eq(orders.paymentStatus, 'paid'),
                    lte(orders.createdAt, fourteenDaysAgo),
                    sql`not exists (select 1 from ${schema.catalogOrders} co join ${schema.catalogOrderItems} ci on ci.order_id = co.id where co.stripe_checkout_session_id = ${orders.stripeCheckoutSessionId} and ci.status != 'delivered')`,
                    sql`not exists (select 1 from ${schema.storeDisputes} d where d.order_id = ${orders.id} and d.status NOT LIKE 'warning_%')`,
                ),
            )
            .get();
        return {
            firstSaleAt: first?.at ? new Date(first.at * 1000) : null,
            completedOrders: completed?.count ?? 0,
            ordersLast90Days: recent?.count ?? 0,
            disputesLast90Days: disputes?.total ?? 0,
            lostDisputesLast90Days: disputes?.lost ?? 0,
        };
    }

    /** Sellers with a store order since this time, for the daily level check. */
    /** Orders recorded in the window that were never settled, oldest first, for the settle sweep. */
    async unsettledOrderIds(after: Date, before: Date): Promise<string[]> {
        const orders = schema.storeOrders;
        const rows = await this.database
            .select({ id: orders.id })
            .from(orders)
            .leftJoin(schema.storeFeeAdjustments, eq(schema.storeFeeAdjustments.orderId, orders.id))
            .where(and(gte(orders.createdAt, after), lte(orders.createdAt, before), isNull(schema.storeFeeAdjustments.orderId)))
            .orderBy(orders.createdAt)
            .limit(50)
            .all();
        return rows.map((row) => row.id);
    }

    async activeSellerIds(since: Date): Promise<string[]> {
        const rows = await this.database.selectDistinct({ id: schema.storeOrders.sellerUserId }).from(schema.storeOrders).where(gte(schema.storeOrders.createdAt, since)).limit(1000).all();
        return rows.map((row) => row.id);
    }
}
