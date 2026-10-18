/** A store order as its owner sees it through the orders API. */

import type { CatalogItemProgress, StoreOrderSummary } from '../../../../shared/types/store-payments';
import type { StoreOrderView } from '../../../services/store-payments/store';

export function orderSummary(order: StoreOrderView, catalogItems: CatalogItemProgress[]): StoreOrderSummary {
    const address = order.shippingAddress;
    return {
        id: order.id,
        orderNumber: order.orderNumber,
        mode: order.mode,
        paymentStatus: order.paymentStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        subtotalCents: order.subtotalCents,
        shippingCents: order.shippingCents,
        totalCents: order.totalCents,
        applicationFeeCents: order.applicationFeeCents,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        shipTo: address
            ? { name: address.name, line1: address.line1, line2: address.line2, city: address.city, region: address.region, postalCode: address.postalCode, countryCode: address.countryCode }
            : null,
        note: order.note,
        needsAttention: order.needsAttention,
        createdAt: order.createdAt.toISOString(),
        items: order.items.map((item) => ({ name: item.name, kind: item.kind, quantity: item.quantity, unitPriceCents: item.unitPriceCents })),
        catalogItems,
    };
}
