import { loadAccount } from '../../../services/billing/account';
import { assertWithinLimit } from '../../../services/i18n/plan-limits';
import { msg } from '../../../../shared/i18n/translate';
/** The signed-in seller's orders across their stores: the list, one order, and marking it shipped. */

import { BaseController } from '../baseController';
import type { RouteContext } from '../../types/route-context';
import type { ApiResponse, ControllerResponse } from '../types';
import { CatalogOrderService, SellerOrderService, StoreOrderService } from '../../../database';
import { parseKeysetCursor } from '../../../database/services/keyset-cursor';
import { isSellerOrderModeFilter, isSellerOrderView, type CatalogItemProgress, type SellerOrderDetail, type SellerOrdersData, type StoreRefundResponse } from '../../../../shared/types/store-payments';
import { parseSellerShipmentRequest } from './shipment-request';
import { parseStoreRefundRequest } from '../stores/refund-request';
import { refundOrderLines } from '../stores/refund-order';
import { sellerOrderDetail } from './order-detail';
import { shopperEmailQueueFromEnv } from '../../../services/shopper-emails/wiring';

const SHIPMENT_REFUSALS = {
    'no-own-items': 'Estori ships everything in this order.',
    'nothing-to-ship': 'Every item you ship in this order was refunded.',
    refunded: 'This order was refunded.',
} as const;

export class SellerOrdersController extends BaseController {
    static async list(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<SellerOrdersData>>> {
        const params = new URL(request.url).searchParams;
        const view = params.get('view') ?? 'to-ship';
        const mode = params.get('mode') ?? 'live';
        const cursor = params.get('cursor');
        if (!isSellerOrderView(view) || !isSellerOrderModeFilter(mode)) return SellerOrdersController.createErrorResponse(msg('Unknown view or mode'), 400);
        if (cursor && !parseKeysetCursor(cursor)) return SellerOrdersController.createErrorResponse(msg('Invalid cursor'), 400);
        try {
            const data = await new SellerOrderService(env).listOrders({ sellerUserId: context.user!.id, view, mode, appId: params.get('store'), cursor });
            return SellerOrdersController.createSuccessResponse(data);
        } catch (error) {
            return SellerOrdersController.handleError(error, 'list orders') as ControllerResponse<ApiResponse<SellerOrdersData>>;
        }
    }

    static async detail(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<SellerOrderDetail>>> {
        const orderId = context.pathParams.id;
        if (!orderId) return SellerOrdersController.createErrorResponse(msg('Missing order id'), 400);
        try {
            const detail = await SellerOrdersController.detailOf(env, context.user!.id, orderId);
            return detail ? SellerOrdersController.createSuccessResponse(detail) : SellerOrdersController.createErrorResponse(msg('Order not found'), 404);
        } catch (error) {
            return SellerOrdersController.handleError(error, 'read an order') as ControllerResponse<ApiResponse<SellerOrderDetail>>;
        }
    }

    static async shipment(request: Request, env: Env, ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<SellerOrderDetail>>> {
        const orderId = context.pathParams.id;
        const body = await SellerOrdersController.parseJsonBody<unknown>(request);
        const shipment = body.success ? parseSellerShipmentRequest(body.data) : null;
        if (!orderId || !shipment) return SellerOrdersController.createErrorResponse(msg('Send shipped, and a known carrier and tracking number'), 400);
        try {
            const sellerUserId = context.user!.id;
            if (shipment.shipped && (shipment.carrier || shipment.trackingNumber)) {
                const order = await new StoreOrderService(env).getOrder(orderId);
                if (!order || order.sellerUserId !== sellerUserId) return SellerOrdersController.createErrorResponse(msg('Order not found'), 404);
                const refusal = assertWithinLimit(await loadAccount(env, sellerUserId), 'shipmentTracking');
                if (refusal) return SellerOrdersController.createPlanLimitResponse(refusal);
            }
            const result = await new SellerOrderService(env).setShipment({
                sellerUserId,
                orderId,
                shipment: shipment.shipped ? { carrier: shipment.carrier, trackingNumber: shipment.trackingNumber } : null,
                now: new Date(),
            });
            if (result === 'not-found') return SellerOrdersController.createErrorResponse(msg('Order not found'), 404);
            if (result !== 'updated') return SellerOrdersController.createErrorResponse(SHIPMENT_REFUSALS[result], 409);
            const detail = await SellerOrdersController.detailOf(env, sellerUserId, orderId);
            // One email per order: an edit, or shipping again after an undo, sends nothing more.
            if (detail && shipment.shipped) {
                await shopperEmailQueueFromEnv(env, (sending) => ctx.waitUntil(sending))({
                    orderId,
                    kind: 'order_shipped',
                    eventKey: 'own',
                    payload: { lineNos: detail.items.filter((item) => item.kind === 'own' && item.productType !== 'digital' && !item.refunded).map((item) => item.lineNo), carrier: detail.carrier, trackingNumber: detail.trackingNumber },
                });
            }
            return detail ? SellerOrdersController.createSuccessResponse(detail) : SellerOrdersController.createErrorResponse(msg('Order not found'), 404);
        } catch (error) {
            return SellerOrdersController.handleError(error, 'update a shipment') as ControllerResponse<ApiResponse<SellerOrderDetail>>;
        }
    }

    /** Refunds lines of the seller's own order; it works for an order whose store was deleted, as the store route can't. */
    static async refund(request: Request, env: Env, ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<StoreRefundResponse>>> {
        const orderId = context.pathParams.id;
        const body = await SellerOrdersController.parseJsonBody<unknown>(request);
        const refundRequest = body.success ? parseStoreRefundRequest(body.data) : null;
        if (!orderId || !refundRequest) return SellerOrdersController.createErrorResponse(msg('Send the lines to refund and a request id'), 400);
        try {
            const order = await new StoreOrderService(env).getOrder(orderId);
            if (!order || order.sellerUserId !== context.user!.id) return SellerOrdersController.createErrorResponse(msg('Order not found'), 404);
            const outcome = await refundOrderLines(env, order, refundRequest, (sending) => ctx.waitUntil(sending));
            if (!outcome.ok && outcome.status === 402) return SellerOrdersController.createPlanLimitResponse(outcome.refusal);
            return outcome.ok ? SellerOrdersController.createSuccessResponse({ refundedCents: outcome.refundedCents }) : SellerOrdersController.createErrorResponse(outcome.message, outcome.status);
        } catch (error) {
            return SellerOrdersController.handleError(error, 'refund an order') as ControllerResponse<ApiResponse<StoreRefundResponse>>;
        }
    }

    private static async detailOf(env: Env, sellerUserId: string, orderId: string): Promise<SellerOrderDetail | null> {
        const order = await new StoreOrderService(env).getOrder(orderId);
        if (!order || order.sellerUserId !== sellerUserId) return null;
        const facts = await new SellerOrderService(env).orderFacts(sellerUserId, orderId);
        if (!facts) return null;
        const sessionId = order.stripeCheckoutSessionId;
        const catalogItems: CatalogItemProgress[] = sessionId ? ((await new CatalogOrderService(env).progressForSessions([sessionId])).get(sessionId) ?? []) : [];
        return sellerOrderDetail(order, facts, catalogItems);
    }
}
