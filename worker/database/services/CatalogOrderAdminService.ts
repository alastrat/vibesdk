/** Catalog orders as admins see them: the ones that need someone, every order, and one order in full. */

import { and, asc, desc, eq, exists, inArray, lt, or, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { keysetCursorOf, parseKeysetCursor } from './keyset-cursor';
import type {
    AdminCatalogOrderDetail,
    AdminCatalogOrdersData,
    AdminCatalogOrderView,
    CatalogItemStatus,
    ShippingAddress,
} from '../../../shared/types/catalog';

/** Items placed, or shipped, since before these dates are late: not shipped, or not delivered. */
export interface LateCutoffs {
    placedBefore: Date;
    shippedBefore: Date;
}

export const ADMIN_CATALOG_ORDERS_PAGE = 50;

export class CatalogOrderAdminService extends BaseService {
    async listOrders(input: { view: AdminCatalogOrderView; late: LateCutoffs; cursor?: string | null; limit?: number }): Promise<AdminCatalogOrdersData> {
        const orders = schema.catalogOrders;
        const items = schema.catalogOrderItems;
        const limit = input.limit ?? ADMIN_CATALOG_ORDERS_PAGE;
        const after = input.cursor ? parseKeysetCursor(input.cursor) : null;
        if (input.cursor && !after) throw new Error('Invalid cursor');

        const lateOrHeldItem = this.database
            .select({ one: sql`1` })
            .from(items)
            .where(
                and(
                    eq(items.orderId, orders.id),
                    or(
                        eq(items.status, 'withheld'),
                        and(eq(items.status, 'placed'), lt(items.updatedAt, input.late.placedBefore)),
                        and(eq(items.status, 'shipped'), lt(items.updatedAt, input.late.shippedBefore)),
                    ),
                ),
            );
        const rows = await this.database
            .select({
                id: orders.id,
                createdAt: orders.createdAt,
                status: orders.status,
                mode: schema.storeOrders.mode,
                orderNumber: schema.storeOrders.orderNumber,
                storeAppId: orders.storeAppId,
                storeTitle: schema.apps.title,
                sellerEmail: schema.users.email,
                lastError: orders.lastError,
            })
            .from(orders)
            .leftJoin(schema.storeOrders, eq(schema.storeOrders.stripeCheckoutSessionId, orders.stripeCheckoutSessionId))
            .leftJoin(schema.apps, eq(schema.apps.id, orders.storeAppId))
            .leftJoin(schema.users, eq(schema.users.id, orders.sellerUserId))
            .where(
                and(
                    input.view === 'attention' ? or(inArray(orders.status, ['needs-attention', 'risk-hold']), exists(lateOrHeldItem)) : undefined,
                    after ? or(lt(orders.createdAt, after.createdAt), and(eq(orders.createdAt, after.createdAt), lt(orders.id, after.id))) : undefined,
                ),
            )
            .orderBy(desc(orders.createdAt), desc(orders.id))
            .limit(limit + 1)
            .all();

        const page = rows.slice(0, limit);
        const counts = await this.itemCounts(page.map((row) => row.id));
        const last = page[page.length - 1];
        return {
            orders: page.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), itemCounts: counts.get(row.id) ?? {} })),
            nextCursor: rows.length > limit && last ? keysetCursorOf(last.createdAt, last.id) : null,
        };
    }

    /** One order with its store, seller, sale and items; the runner and sandbox flag come from elsewhere. */
    async getOrder(orderId: string): Promise<Omit<AdminCatalogOrderDetail, 'sandbox' | 'runner'> | null> {
        const orders = schema.catalogOrders;
        const items = schema.catalogOrderItems;
        const row = await this.database
            .select({
                id: orders.id,
                createdAt: orders.createdAt,
                status: orders.status,
                mode: schema.storeOrders.mode,
                orderNumber: schema.storeOrders.orderNumber,
                storeOrderId: schema.storeOrders.id,
                refundedCents: schema.storeOrders.refundedCents,
                storeAppId: orders.storeAppId,
                storeTitle: schema.apps.title,
                sellerUserId: orders.sellerUserId,
                sellerEmail: schema.users.email,
                stripePaymentIntentId: orders.stripePaymentIntentId,
                currency: orders.currency,
                totalCents: orders.totalCents,
                catalogTotalCents: orders.catalogTotalCents,
                applicationFeeCents: orders.applicationFeeCents,
                shippingAddress: orders.shippingAddress,
                placementAttempts: orders.placementAttempts,
                lastError: orders.lastError,
            })
            .from(orders)
            .leftJoin(schema.storeOrders, eq(schema.storeOrders.stripeCheckoutSessionId, orders.stripeCheckoutSessionId))
            .leftJoin(schema.apps, eq(schema.apps.id, orders.storeAppId))
            .leftJoin(schema.users, eq(schema.users.id, orders.sellerUserId))
            .where(eq(orders.id, orderId))
            .get();
        if (!row) return null;

        const itemRows = await this.database
            .select({
                id: items.id,
                catalogVariantId: items.catalogVariantId,
                quantity: items.quantity,
                unitPriceCents: items.unitPriceCents,
                catalogPriceCents: items.catalogPriceCents,
                status: items.status,
                supplierOrderId: items.supplierOrderId,
                trackingNumber: items.trackingNumber,
                carrier: items.carrier,
                supplierRefunded: items.supplierRefunded,
            })
            .from(items)
            .where(eq(items.orderId, orderId))
            .orderBy(asc(items.id))
            .all();
        const names = row.storeOrderId ? await this.catalogLineNames(row.storeOrderId) : new Map<string, string>();
        const { storeOrderId: _storeOrderId, shippingAddress, refundedCents, createdAt, ...order } = row;
        return {
            ...order,
            createdAt: createdAt.toISOString(),
            refundedCents: refundedCents ?? 0,
            shipTo: JSON.parse(shippingAddress) as ShippingAddress,
            items: itemRows.map((item) => ({ ...item, name: names.get(item.catalogVariantId) ?? null })),
        };
    }

    private async itemCounts(orderIds: string[]): Promise<Map<string, Partial<Record<CatalogItemStatus, number>>>> {
        const counts = new Map<string, Partial<Record<CatalogItemStatus, number>>>();
        if (orderIds.length === 0) return counts;
        const items = schema.catalogOrderItems;
        const rows = await this.database
            .select({ orderId: items.orderId, status: items.status, count: sql<number>`count(*)` })
            .from(items)
            .where(inArray(items.orderId, orderIds))
            .groupBy(items.orderId, items.status)
            .all();
        for (const row of rows) counts.set(row.orderId, { ...counts.get(row.orderId), [row.status]: Number(row.count) });
        return counts;
    }

    /** The store order's name for each catalog variant it sold. */
    private async catalogLineNames(storeOrderId: string): Promise<Map<string, string>> {
        const lines = await this.database
            .select({ catalogVariantId: schema.storeOrderItems.catalogVariantId, name: schema.storeOrderItems.name })
            .from(schema.storeOrderItems)
            .where(and(eq(schema.storeOrderItems.orderId, storeOrderId), eq(schema.storeOrderItems.kind, 'catalog')))
            .all();
        const names = new Map<string, string>();
        for (const line of lines) if (line.catalogVariantId && !names.has(line.catalogVariantId)) names.set(line.catalogVariantId, line.name);
        return names;
    }
}
