/** D1 reads and writes for catalog orders and their items. */

import { and, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import type { CatalogOrderRow, CatalogOrderStore, ItemPatch, NewCatalogOrder } from '../../services/catalog/store';
import type { ShippingAddress } from '../../services/catalog/supplier';
import type { CatalogOrderStatus } from '../../../shared/types/catalog';
import type { CatalogItemProgress } from '../../../shared/types/store-payments';

function isUniqueViolation(error: unknown): boolean {
    return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

export class CatalogOrderService extends BaseService implements CatalogOrderStore {
    async insertPaidOrder(order: NewCatalogOrder): Promise<boolean> {
        const at = order.createdAt;
        try {
            await this.database.batch([
                this.database.insert(schema.catalogOrders).values({
                    id: order.id,
                    sellerUserId: order.sellerUserId,
                    storeAppId: order.storeAppId,
                    stripeCheckoutSessionId: order.checkoutSessionId,
                    stripePaymentIntentId: order.paymentIntentId,
                    totalCents: order.totalCents,
                    catalogTotalCents: order.catalogTotalCents,
                    applicationFeeCents: order.applicationFeeCents,
                    destinationCountry: order.destinationCountry,
                    shippingAddress: JSON.stringify(order.shippingAddress),
                    createdAt: at,
                    updatedAt: at,
                }),
                // One statement per item: D1 binds at most 100 parameters per statement, and an item takes 11.
                ...order.items.map((item) => this.database.insert(schema.catalogOrderItems).values({ ...item, orderId: order.id, updatedAt: at })),
            ]);
            return true;
        } catch (error) {
            // The unique session index refuses a second order for the same payment; the batch writes nothing.
            if (isUniqueViolation(error)) return false;
            throw error;
        }
    }

    async getOrder(orderId: string): Promise<CatalogOrderRow | null> {
        return this.orderWhere(eq(schema.catalogOrders.id, orderId));
    }

    /** The catalog part of a store order, found by its Checkout session. */
    async getOrderBySession(checkoutSessionId: string): Promise<CatalogOrderRow | null> {
        return this.orderWhere(eq(schema.catalogOrders.stripeCheckoutSessionId, checkoutSessionId));
    }

    private async orderWhere(condition: ReturnType<typeof eq>): Promise<CatalogOrderRow | null> {
        const order = await this.database
            .select({
                id: schema.catalogOrders.id,
                sellerUserId: schema.catalogOrders.sellerUserId,
                status: schema.catalogOrders.status,
                paymentIntentId: schema.catalogOrders.stripePaymentIntentId,
                placementAttempts: schema.catalogOrders.placementAttempts,
                shippingAddress: schema.catalogOrders.shippingAddress,
            })
            .from(schema.catalogOrders)
            .where(condition)
            .get();
        if (!order) return null;
        const items = await this.database
            .select({
                id: schema.catalogOrderItems.id,
                catalogVariantId: schema.catalogOrderItems.catalogVariantId,
                supplier: schema.catalogOrderItems.supplier,
                supplierVariantId: schema.catalogOrderItems.supplierVariantId,
                quantity: schema.catalogOrderItems.quantity,
                unitPriceCents: schema.catalogOrderItems.unitPriceCents,
                catalogPriceCents: schema.catalogOrderItems.catalogPriceCents,
                status: schema.catalogOrderItems.status,
                supplierOrderId: schema.catalogOrderItems.supplierOrderId,
                trackingNumber: schema.catalogOrderItems.trackingNumber,
                carrier: schema.catalogOrderItems.carrier,
                supplierRefunded: schema.catalogOrderItems.supplierRefunded,
                sellerReversalDueCents: schema.catalogOrderItems.sellerReversalDueCents,
            })
            .from(schema.catalogOrderItems)
            .where(eq(schema.catalogOrderItems.orderId, order.id))
            .all();
        const shippingAddress: ShippingAddress = JSON.parse(order.shippingAddress);
        return { ...order, shippingAddress, items };
    }

    async patchItems(patches: readonly ItemPatch[]): Promise<void> {
        const now = new Date();
        const [first, ...rest] = patches.map(({ itemId, ...fields }) =>
            this.database.update(schema.catalogOrderItems).set({ ...fields, updatedAt: now }).where(eq(schema.catalogOrderItems.id, itemId)),
        );
        // Drizzle's batch takes a non-empty list, and an empty list of patches has nothing to write.
        if (!first) return;
        await this.database.batch([first, ...rest]);
    }

    async updateOrder(orderId: string, update: { status: CatalogOrderStatus; placementAttempts: number; lastError: string | null }): Promise<void> {
        await this.database
            .update(schema.catalogOrders)
            .set({ ...update, updatedAt: new Date() })
            .where(eq(schema.catalogOrders.id, orderId));
    }

    /** Catalog items of each paid Checkout session, for the seller's order list. */
    async progressForSessions(sessionIds: readonly string[]): Promise<Map<string, CatalogItemProgress[]>> {
        const progress = new Map<string, CatalogItemProgress[]>();
        if (sessionIds.length === 0) return progress;
        const rows = await this.database
            .select({
                sessionId: schema.catalogOrders.stripeCheckoutSessionId,
                catalogVariantId: schema.catalogOrderItems.catalogVariantId,
                quantity: schema.catalogOrderItems.quantity,
                status: schema.catalogOrderItems.status,
                trackingNumber: schema.catalogOrderItems.trackingNumber,
                carrier: schema.catalogOrderItems.carrier,
            })
            .from(schema.catalogOrderItems)
            .innerJoin(schema.catalogOrders, eq(schema.catalogOrderItems.orderId, schema.catalogOrders.id))
            .where(inArray(schema.catalogOrders.stripeCheckoutSessionId, [...sessionIds]))
            .all();
        for (const { sessionId, ...item } of rows) progress.set(sessionId, [...(progress.get(sessionId) ?? []), item]);
        return progress;
    }

    /** Paid orders still awaiting their first placement attempt, created before `before`: their hand-off was lost. */
    async unstartedOrderIds(before: Date): Promise<string[]> {
        const rows = await this.database
            .select({ id: schema.catalogOrders.id })
            .from(schema.catalogOrders)
            .where(and(eq(schema.catalogOrders.status, 'awaiting-placement'), eq(schema.catalogOrders.placementAttempts, 0), lt(schema.catalogOrders.createdAt, before)))
            .limit(100)
            .all();
        return rows.map((row) => row.id);
    }

    /**
     * Orders with an item in this status since before `before`, but no earlier than `since`: late to ship ('placed') or
     * to arrive ('shipped'), and still within the window in which they're alerted.
     */
    async lateItems(status: 'placed' | 'shipped', before: Date, since: Date): Promise<string[]> {
        const rows = await this.database
            .selectDistinct({ orderId: schema.catalogOrderItems.orderId })
            .from(schema.catalogOrderItems)
            .where(and(eq(schema.catalogOrderItems.status, status), lt(schema.catalogOrderItems.updatedAt, before), gt(schema.catalogOrderItems.updatedAt, since)))
            .limit(100)
            .all();
        return rows.map((row) => row.orderId);
    }

    /** The Checkout session and catalog variant of one catalog item, for recording its refund on the store order. */
    async locateItem(itemId: string): Promise<{ checkoutSessionId: string; catalogVariantId: string; sellerUserId: string } | null> {
        const row = await this.database
            .select({ checkoutSessionId: schema.catalogOrders.stripeCheckoutSessionId, catalogVariantId: schema.catalogOrderItems.catalogVariantId, sellerUserId: schema.catalogOrders.sellerUserId })
            .from(schema.catalogOrderItems)
            .innerJoin(schema.catalogOrders, eq(schema.catalogOrders.id, schema.catalogOrderItems.orderId))
            .where(eq(schema.catalogOrderItems.id, itemId))
            .get();
        return row ?? null;
    }

    /** A disputed order's catalog items not yet bought: neither placed nor refunded, since the dispute returned the money. */
    async withholdPending(checkoutSessionId: string): Promise<void> {
        await this.database
            .update(schema.catalogOrderItems)
            .set({ status: 'withheld', updatedAt: new Date() })
            .where(and(
                eq(schema.catalogOrderItems.status, 'pending'),
                inArray(
                    schema.catalogOrderItems.orderId,
                    this.database.select({ id: schema.catalogOrders.id }).from(schema.catalogOrders).where(eq(schema.catalogOrders.stripeCheckoutSessionId, checkoutSessionId)),
                ),
            ))
            .run();
    }

    /** A won dispute's withheld items go back to be bought; returns the catalog order to restart, if any. */
    async releaseWithheld(checkoutSessionId: string): Promise<string | null> {
        const order = await this.database
            .select({ id: schema.catalogOrders.id })
            .from(schema.catalogOrders)
            .where(eq(schema.catalogOrders.stripeCheckoutSessionId, checkoutSessionId))
            .get();
        if (!order) return null;
        await this.database
            .update(schema.catalogOrderItems)
            .set({ status: 'pending', updatedAt: new Date() })
            .where(and(eq(schema.catalogOrderItems.orderId, order.id), eq(schema.catalogOrderItems.status, 'withheld')))
            .run();
        return order.id;
    }

    /** The catalog price of a disputed order's withheld items: what Estori kept for goods it never bought. */
    async withheldCatalogCents(checkoutSessionId: string): Promise<number> {
        const row = await this.database
            .select({ cents: sql<number>`COALESCE(SUM(${schema.catalogOrderItems.catalogPriceCents} * ${schema.catalogOrderItems.quantity}), 0)` })
            .from(schema.catalogOrderItems)
            .innerJoin(schema.catalogOrders, eq(schema.catalogOrders.id, schema.catalogOrderItems.orderId))
            .where(and(eq(schema.catalogOrders.stripeCheckoutSessionId, checkoutSessionId), eq(schema.catalogOrderItems.status, 'withheld')))
            .get();
        return row?.cents ?? 0;
    }
}
