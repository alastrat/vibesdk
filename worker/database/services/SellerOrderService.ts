/** A seller's own store orders: the Orders page's list and order facts, and marking an order shipped. Every query is scoped to the seller. */

import { and, asc, desc, eq, inArray, isNotNull, lt, or, sql, type SQL } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { keysetCursorOf, parseKeysetCursor } from './keyset-cursor';
import type { SellerOrderModeFilter, SellerOrdersData, SellerOrderView } from '../../../shared/types/store-payments';

export const SELLER_ORDERS_PAGE = 50;

export interface SellerOrderFacts {
    digitalLineNos?: number[];
    storeTitle: string | null;
    carrier: string | null;
    trackingNumber: string | null;
    shippedAt: Date | null;
    /** Lines whose refund Stripe made. */
    refundedLineNos: number[];
    /** Lines whose refund was claimed but never made; refunding them again finishes it. */
    pendingRefundLineNos: number[];
    dispute: { amountCents: number; status: string } | null;
}

export type ShipmentResult = 'updated' | 'not-found' | 'no-own-items' | 'nothing-to-ship' | 'refunded';

/** Legacy snapshots without productType retain physical fulfillment. */
function physicalLine(checkoutId: SQL, variantId: SQL): SQL {
    return sql`NOT EXISTS (SELECT 1 FROM store_checkouts c, json_each(c.priced_cart, '$.lines') purchased WHERE c.id = ${checkoutId} AND json_extract(purchased.value, '$.variantId') = ${variantId} AND json_extract(purchased.value, '$.productType') = 'digital')`;
}

/** Units of this kind on the order with no refund made; a claim Stripe never completed still counts. */
function unrefundedUnits(kind: 'own' | 'catalog') {
    return sql<number>`(SELECT COALESCE(SUM(i.quantity), 0) FROM store_order_items i WHERE i.order_id = ${schema.storeOrders.id} AND i.kind = ${kind} AND ${kind === 'own' ? physicalLine(sql`${schema.storeOrders.checkoutId}`, sql`i.variant_id`) : sql`1 = 1`} AND NOT EXISTS (SELECT 1 FROM store_refunds r WHERE r.order_id = i.order_id AND r.line_no = i.line_no AND r.stripe_refund_id IS NOT NULL))`;
}

export class SellerOrderService extends BaseService {
    async listOrders(input: { sellerUserId: string; view: SellerOrderView; mode: SellerOrderModeFilter; appId?: string | null; cursor?: string | null; limit?: number }): Promise<SellerOrdersData> {
        const orders = schema.storeOrders;
        const limit = input.limit ?? SELLER_ORDERS_PAGE;
        const after = input.cursor ? parseKeysetCursor(input.cursor) : null;
        if (input.cursor && !after) throw new Error('Invalid cursor');
        const ownToShip = sql`EXISTS (SELECT 1 FROM store_order_items i WHERE i.order_id = ${orders.id} AND i.kind = 'own' AND ${physicalLine(sql`${orders.checkoutId}`, sql`i.variant_id`)} AND NOT EXISTS (SELECT 1 FROM store_refunds r WHERE r.order_id = i.order_id AND r.line_no = i.line_no AND r.stripe_refund_id IS NOT NULL))`;

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
        const productLines = page.length ? await this.database
            .select({ orderId: schema.storeOrderItems.orderId, id: schema.storeOrderItems.productId, name: schema.storeOrderItems.name })
            .from(schema.storeOrderItems)
            .where(inArray(schema.storeOrderItems.orderId, page.map(row => row.id)))
            .orderBy(asc(schema.storeOrderItems.lineNo)).all() : [];
        const productsByOrder = new Map<string, Map<string, { id: string; name: string }>>();
        for (const line of productLines) {
            const products = productsByOrder.get(line.orderId) ?? new Map<string, { id: string; name: string }>();
            if (!products.has(line.id)) products.set(line.id, { id: line.id, name: line.name });
            productsByOrder.set(line.orderId, products);
        }
        return {
            orders: page.map((row) => ({ ...row, products: [...(productsByOrder.get(row.id)?.values() ?? [])], createdAt: row.createdAt.toISOString(), units: Number(row.units), ownUnits: Number(row.ownUnits), catalogUnits: Number(row.catalogUnits) })),
            nextCursor: rows.length > limit && last ? keysetCursorOf(last.createdAt, last.id) : null,
            stores,
            hasTestOrders: Boolean(testOrder),
        };
    }

    async orderFacts(sellerUserId: string, orderId: string): Promise<SellerOrderFacts | null> {
        const orders = schema.storeOrders;
        const row = await this.database
            .select({ storeTitle: schema.apps.title, carrier: orders.carrier, trackingNumber: orders.trackingNumber, shippedAt: orders.shippedAt })
            .from(orders)
            .leftJoin(schema.apps, eq(schema.apps.id, orders.appId))
            .where(and(eq(orders.id, orderId), eq(orders.sellerUserId, sellerUserId)))
            .get();
        if (!row) return null;
        const [refunds, dispute, digitalLines] = await Promise.all([
            this.database
                .select({ lineNo: schema.storeRefunds.lineNo, stripeRefundId: schema.storeRefunds.stripeRefundId })
                .from(schema.storeRefunds)
                .where(eq(schema.storeRefunds.orderId, orderId))
                .orderBy(asc(schema.storeRefunds.lineNo))
                .all(),
            this.database
                .select({ amountCents: schema.storeDisputes.amountCents, status: schema.storeDisputes.status })
                .from(schema.storeDisputes)
                .where(eq(schema.storeDisputes.orderId, orderId))
                .orderBy(desc(schema.storeDisputes.createdAt))
                .limit(1)
                .get(),
            this.database.select({lineNo: schema.storeOrderItems.lineNo})
                .from(schema.storeOrderItems)
                .where(and(eq(schema.storeOrderItems.orderId, orderId), sql`NOT ${physicalLine(sql`(SELECT checkout_id FROM store_orders WHERE id = ${orderId})`, sql`${schema.storeOrderItems.variantId}`)}`)).all(),
        ]);
        return {
            ...row,
            ...(digitalLines.length ? {digitalLineNos: digitalLines.map(line => line.lineNo)} : {}),
            refundedLineNos: refunds.filter((refund) => refund.stripeRefundId !== null).map((refund) => refund.lineNo),
            pendingRefundLineNos: refunds.filter((refund) => refund.stripeRefundId === null).map((refund) => refund.lineNo),
            dispute: dispute ?? null,
        };
    }

    /** Marks the order's own items shipped, or not shipped again with `shipment: null`. An edit keeps the first shipped date. */
    async setShipment(input: { sellerUserId: string; orderId: string; shipment: { carrier: string | null; trackingNumber: string | null } | null; now: Date }): Promise<ShipmentResult> {
        const orders = schema.storeOrders;
        const order = await this.database
            .select({ paymentStatus: orders.paymentStatus, shippedAt: orders.shippedAt, checkoutId: orders.checkoutId })
            .from(orders)
            .where(and(eq(orders.id, input.orderId), eq(orders.sellerUserId, input.sellerUserId)))
            .get();
        if (!order) return 'not-found';
        const ownLines = await this.database
            .select({ lineNo: schema.storeOrderItems.lineNo })
            .from(schema.storeOrderItems)
            .where(and(eq(schema.storeOrderItems.orderId, input.orderId), eq(schema.storeOrderItems.kind, 'own'), physicalLine(sql`${order.checkoutId}`, sql`${schema.storeOrderItems.variantId}`)))
            .all();
        if (ownLines.length === 0) return 'no-own-items';
        const touch = { revision: sql`${orders.revision} + 1`, updatedAt: input.now };
        if (!input.shipment) {
            await this.database.update(orders).set({ fulfillmentStatus: 'unfulfilled', carrier: null, trackingNumber: null, shippedAt: null, ...touch }).where(eq(orders.id, input.orderId)).run();
            return 'updated';
        }
        if (order.paymentStatus === 'refunded') return 'refunded';
        const refundRows = await this.database
            .select({ lineNo: schema.storeRefunds.lineNo })
            .from(schema.storeRefunds)
            .where(and(eq(schema.storeRefunds.orderId, input.orderId), isNotNull(schema.storeRefunds.stripeRefundId)))
            .all();
        const refunded = new Set(refundRows.map((row) => row.lineNo));
        if (ownLines.every((line) => refunded.has(line.lineNo))) return 'nothing-to-ship';
        await this.database
            .update(orders)
            .set({ fulfillmentStatus: 'fulfilled', carrier: input.shipment.carrier, trackingNumber: input.shipment.trackingNumber, shippedAt: order.shippedAt ?? input.now, ...touch })
            .where(eq(orders.id, input.orderId))
            .run();
        return 'updated';
    }

    async newOrderEmailFacts(orderId: string): Promise<{ storeTitle: string | null; sellerEmail: string | null; digitalLineNos?: number[] } | null> {
        const row = await this.database
            .select({ storeTitle: schema.apps.title, sellerEmail: schema.users.email })
            .from(schema.storeOrders)
            .leftJoin(schema.apps, eq(schema.apps.id, schema.storeOrders.appId))
            .leftJoin(schema.users, eq(schema.users.id, schema.storeOrders.sellerUserId))
            .where(eq(schema.storeOrders.id, orderId))
            .get();
        if (!row) return null;
        const digitalLines = await this.database.select({lineNo: schema.storeOrderItems.lineNo})
            .from(schema.storeOrderItems)
            .where(and(eq(schema.storeOrderItems.orderId, orderId), sql`NOT ${physicalLine(sql`(SELECT checkout_id FROM store_orders WHERE id = ${orderId})`, sql`${schema.storeOrderItems.variantId}`)}`)).all();
        return {...row, ...(digitalLines.length ? {digitalLineNos: digitalLines.map(line => line.lineNo)} : {})};
    }
}
