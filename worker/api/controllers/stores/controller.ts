/** A store's orders, for its owner. */

import { BaseController } from '../baseController';
import { RouteContext } from '../../types/route-context';
import { ApiResponse, ControllerResponse } from '../types';
import { CatalogOrderService, StoreOrderService } from '../../../database';
import type { StoreOrdersData, StoreOrderSummary } from '../../../../shared/types/store-payments';
import type { StoreOrderView } from '../../../services/store-payments/store';
import type { CatalogItemProgress } from '../../../../shared/types/store-payments';

function summaryOf(order: StoreOrderView, catalogItems: CatalogItemProgress[]): StoreOrderSummary {
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
        needsAttention: order.needsAttention,
        createdAt: order.createdAt.toISOString(),
        items: order.items.map((item) => ({ name: item.name, kind: item.kind, quantity: item.quantity, unitPriceCents: item.unitPriceCents })),
        catalogItems,
    };
}

export class StoreOrdersController extends BaseController {
    static async list(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<StoreOrdersData>>> {
        try {
            const appId = context.pathParams.id;
            if (!appId) return this.createErrorResponse<StoreOrdersData>('Missing store id', 400);
            const orders = await new StoreOrderService(env).listOrders(appId);
            const sessionIds = orders.flatMap((order) => order.stripeCheckoutSessionId ?? []);
            const progress = await new CatalogOrderService(env).progressForSessions(sessionIds);
            return this.createSuccessResponse<StoreOrdersData>({
                orders: orders.map((order) => summaryOf(order, (order.stripeCheckoutSessionId && progress.get(order.stripeCheckoutSessionId)) || [])),
            });
        } catch (error) {
            return this.handleError(error, 'list store orders') as ControllerResponse<ApiResponse<StoreOrdersData>>;
        }
    }
}
