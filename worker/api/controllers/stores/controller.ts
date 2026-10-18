/** A store's orders, for its owner. */

import { BaseController } from '../baseController';
import { RouteContext } from '../../types/route-context';
import { ApiResponse, ControllerResponse } from '../types';
import { CatalogOrderService, StoreCheckoutService, StoreOrderService, StripeConnectService } from '../../../database';
import { PAYMENTS_NOT_CONFIGURED_MESSAGE, stripeFromEnv, stripeModeOf } from '../../../services/payments/config';
import { getSellerLimitsSettings } from '../../../config';
import { limitsView } from './limits-view';
import type { SellerLimitsData } from '../../../../shared/types/seller-levels';
import { refundStoreLines } from '../../../services/store-payments/refund-lines';
import { storeRefundDeps } from '../../../services/store-payments/wiring';
import { parseStoreRefundRequest, shortBalanceMessage } from './refund-request';
import type { StoreOrdersData, StoreRefundResponse } from '../../../../shared/types/store-payments';
import { orderSummary } from './order-summary';

export class StoreOrdersController extends BaseController {
    /** The signed-in seller's level, store limits and this week's use. */
    static async limits(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<SellerLimitsData>>> {
        try {
            const userId = context.user!.id;
            const mode = stripeModeOf(env) === 'live' ? 'live' : 'test';
            const nowMs = Date.now();
            const [record, settings, stored, weeklySalesUsedCents] = await Promise.all([
                new StoreOrderService(env).sellerRecord(userId, mode, nowMs),
                getSellerLimitsSettings(env, userId),
                new StripeConnectService(env).getByUser(userId),
                new StoreCheckoutService(env).weeklyUsage(userId, mode, new Date(nowMs - 7 * 24 * 60 * 60 * 1000)),
            ]);
            return this.createSuccessResponse<SellerLimitsData>(limitsView({ record, settings, storedLevel: stored?.sellerLevel ?? 'new', storedPayoutDelayDays: stored?.payoutDelayDays ?? null, weeklySalesUsedCents, nowMs }));
        } catch (error) {
            this.logger.error('Failed to load store limits', error);
            return this.createErrorResponse<SellerLimitsData>('Failed to load your store limits', 500);
        }
    }

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
                orders: orders.map((order) => orderSummary(order, (order.stripeCheckoutSessionId && progress.get(order.stripeCheckoutSessionId)) || [])),
            });
        } catch (error) {
            return this.handleError(error, 'list store orders') as ControllerResponse<ApiResponse<StoreOrdersData>>;
        }
    }

    /** The owner refunds lines of an order; nothing moves unless their Stripe balance covers it. */
    static async refund(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<StoreRefundResponse>>> {
        try {
            const appId = context.pathParams.id;
            const orderId = context.pathParams.orderId;
            const body = await this.parseJsonBody<unknown>(request);
            const refundRequest = body.success ? parseStoreRefundRequest(body.data) : null;
            if (!appId || !orderId || !refundRequest) return this.createErrorResponse<StoreRefundResponse>('Send the lines to refund and a request id', 400);
            const stripe = stripeFromEnv(env);
            if (!stripe) return this.createErrorResponse<StoreRefundResponse>(PAYMENTS_NOT_CONFIGURED_MESSAGE, 400);
            const orders = new StoreOrderService(env);
            const order = await orders.getOrder(orderId);
            if (!order || order.appId !== appId) return this.createErrorResponse<StoreRefundResponse>('Order not found', 404);
            const sellerAccountId = order.sellerStripeAccountId;
            if (!sellerAccountId) return this.createErrorResponse<StoreRefundResponse>('This order has no seller account to refund from', 400);

            const result = await refundStoreLines(storeRefundDeps(env, stripe, { order, sellerAccountId, requestId: refundRequest.requestId }), {
                order,
                lineNos: refundRequest.lineNos,
                requestId: refundRequest.requestId,
            });
            if (result.ok) return this.createSuccessResponse<StoreRefundResponse>({ refundedCents: result.refundedCents });
            if (result.reason === 'seller_balance_short') return this.createErrorResponse<StoreRefundResponse>(shortBalanceMessage(result.shortCents), 409);
            if (result.reason === 'unknown_lines') return this.createErrorResponse<StoreRefundResponse>(`This order has no line ${result.lineNos.join(', ')}`, 400);
            return this.createErrorResponse<StoreRefundResponse>('These lines were already refunded', 400);
        } catch (error) {
            return this.handleError(error, 'refund a store order') as ControllerResponse<ApiResponse<StoreRefundResponse>>;
        }
    }
}
