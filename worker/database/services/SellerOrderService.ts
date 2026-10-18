/** A seller's own store orders: the Orders page's list and order facts, and marking an order shipped. Every query is scoped to the seller. */

import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { keysetCursorOf, parseKeysetCursor } from './keyset-cursor';
import type { SellerOrderModeFilter, SellerOrdersData, SellerOrderView } from '../../../shared/types/store-payments';

export const SELLER_ORDERS_PAGE = 50;

/** Units of this kind on the order with no refund claimed or made. */
function unrefundedUnits(kind: 'own' | 'catalog') {
    return sql<number>`(SELECT COALESCE(SUM(i.quantity), 0) FROM store_order_items i WHERE i.order_id = ${schema.storeOrders.id} AND i.kind = ${kind} AND NOT EXISTS (SELECT 1 FROM store_refunds r WHERE r.order_id = i.order_id AND r.line_no = i.line_no))`;
}

export class SellerOrderService extends BaseService {
    async listOrders(input: { sellerUserId: string; view: SellerOrderView; mode: SellerOrderModeFilter; appId?: string | null; cursor?: string | null; limit?: number }): Promise<SellerOrdersData> {
        const orders = schema.storeOrders;
        const limit = input.limit ?? SELLER_ORDERS_PAGE;
        const after = input.cursor ? parseKeysetCursor(input.cursor) : null;
        if (input.cursor && !after) throw new Error('Invalid cursor');
        const ownToShip = sql`EXISTS (SELECT 1 FROM store_order_items i WHERE i.order_id = ${orders.id} AND i.kind = 'own' AND NOT EXISTS (SELECT 1 FROM store_refunds r WHERE r.order_id = i.order_id AND r.line_no = i.line_no))`;

        const rows = await this.database
            .select({
                id: orders.id,
                orderNumber: orders.orderNumber,
                mode: orders.mode,
                appId: orders.appId,
                storeTitle: schema.apps.title,
                createdAt: orders.createdAt,
                customerName: orders.customerName,
                customerEmail: orders.customerEmail,
                totalCents: orders.totalCents,
                paymentStatus: orders.paymentStatus,
                fulfillmentStatus: orders.fulfillmentStatus,
                units: sql<number>`(SELECT COALESCE(SUM(quantity), 0) FROM store_order_items WHERE store_order_items.order_id = ${orders.id})`,
                ownUnits: unrefundedUnits('own'),
                catalogUnits: unrefundedUnits('catalog'),
            })
            .from(orders)
            .leftJoin(schema.apps, eq(schema.apps.id, orders.appId))
            .where(
                and(
                    eq(orders.sellerUserId, input.sellerUserId),
                    input.mode === 'live' ? eq(orders.mode, 'live') : undefined,
                    input.appId ? eq(orders.appId, input.appId) : undefined,
                    input.view === 'to-ship' ? and(inArray(orders.paymentStatus, ['paid', 'partially_refunded']), eq(orders.fulfillmentStatus, 'unfulfilled'), ownToShip) : undefined,
                    after ? or(lt(orders.createdAt, after.createdAt), and(eq(orders.createdAt, after.createdAt), lt(orders.id, after.id))) : undefined,
                ),
            )
            .orderBy(desc(orders.createdAt), desc(orders.id))
            .limit(limit + 1)
            .all();

        const page = rows.slice(0, limit);
        const last = page[page.length - 1];
        const [stores, testOrder] = await Promise.all([
            this.database
                .selectDistinct({ appId: orders.appId, title: schema.apps.title })
                .from(orders)
                .leftJoin(schema.apps, eq(schema.apps.id, orders.appId))
                .where(eq(orders.sellerUserId, input.sellerUserId))
                .all(),
            this.database
                .select({ id: orders.id })
                .from(orders)
                .where(and(eq(orders.sellerUserId, input.sellerUserId), eq(orders.mode, 'test')))
                .limit(1)
                .get(),
        ]);
        return {
            orders: page.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), units: Number(row.units), ownUnits: Number(row.ownUnits), catalogUnits: Number(row.catalogUnits) })),
            nextCursor: rows.length > limit && last ? keysetCursorOf(last.createdAt, last.id) : null,
            stores,
            hasTestOrders: Boolean(testOrder),
        };
    }
}
