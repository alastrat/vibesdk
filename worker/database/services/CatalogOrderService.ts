/** D1 reads and writes for catalog orders and their items. */

import { eq } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import type { CatalogOrderRow, CatalogOrderStore, ItemPatch, NewCatalogOrder } from '../../services/catalog/store';
import type { ShippingAddress } from '../../services/catalog/supplier';
import type { CatalogOrderStatus } from '../../../shared/types/catalog';

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
        const order = await this.database
            .select({
                id: schema.catalogOrders.id,
                status: schema.catalogOrders.status,
                paymentIntentId: schema.catalogOrders.stripePaymentIntentId,
                placementAttempts: schema.catalogOrders.placementAttempts,
                shippingAddress: schema.catalogOrders.shippingAddress,
            })
            .from(schema.catalogOrders)
            .where(eq(schema.catalogOrders.id, orderId))
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
            .where(eq(schema.catalogOrderItems.orderId, orderId))
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
}
