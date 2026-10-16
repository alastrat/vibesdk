/** D1 reads and writes for store orders and their items. */

import { and, desc, eq, inArray, max } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import type { NewStoreOrder, NewStoreOrderItem, StoreOrderView } from '../../services/store-payments/store';
import type { ShippingAddress } from '../../services/catalog/supplier';

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
                createdAt: order.createdAt,
                items: lines,
            };
        });
    }
}
