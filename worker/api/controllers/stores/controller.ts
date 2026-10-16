/** A store's orders, for its owner. */

import { BaseController } from '../baseController';
import { RouteContext } from '../../types/route-context';
import { ApiResponse, ControllerResponse } from '../types';
import { CatalogOrderService, StoreOrderService, StoreRefundService } from '../../../database';
import { PAYMENTS_NOT_CONFIGURED_MESSAGE, stripeFromEnv } from '../../../services/payments/config';
import { refundCatalogItems, SellerBalanceShortError } from '../../../services/catalog/refund-items';
import { refundStoreLines } from '../../../services/store-payments/refund-lines';
import { parseStoreRefundRequest, shortBalanceMessage } from './refund-request';
import type { StoreOrdersData, StoreOrderSummary, StoreRefundResponse } from '../../../../shared/types/store-payments';
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
            const checkoutSessionId = order.stripeCheckoutSessionId;
            if (!sellerAccountId) return this.createErrorResponse<StoreRefundResponse>('This order has no seller account to refund from', 400);

            const refunds = new StoreRefundService(env);
            const catalog = new CatalogOrderService(env);
            const sellerBalance = () => stripe.retrieveBalance(sellerAccountId);
            const now = () => new Date();
            const result = await refundStoreLines(
                {
                    stripe,
                    sellerBalance,
                    refundedLines: (id) => refunds.refundedLines(id),
                    recordRefund: (entry) => refunds.record(entry),
                    applyRefunds: (id) => orders.applyRefunds(id, now()),
                    now,
                    refundCatalogLines: async (lineNos) => {
                        const catalogOrder = checkoutSessionId ? await catalog.getOrderBySession(checkoutSessionId) : null;
                        if (!catalogOrder || !checkoutSessionId) return { ok: false, reason: 'nothing_to_refund' };
                        const variants = new Set(order.items.filter((item) => lineNos.includes(item.lineNo)).map((item) => item.catalogVariantId));
                        const itemIds = catalogOrder.items.filter((item) => variants.has(item.catalogVariantId)).map((item) => item.id);
                        try {
                            const totals = await refundCatalogItems(
                                {
                                    store: catalog,
                                    stripe,
                                    sellerBalance,
                                    recordRefund: async (entry) => {
                                        const item = catalogOrder.items.find((candidate) => candidate.id === entry.catalogItemId);
                                        if (!item) return;
                                        await refunds.recordForCatalogItem({ checkoutSessionId, catalogVariantId: item.catalogVariantId, refundId: entry.refundId, amountCents: entry.amountCents, now: now() });
                                    },
                                },
                                { orderId: catalogOrder.id, itemIds, reason: 'seller-refund' },
                            );
                            return { ok: true, refundedCents: totals.shopperCents };
                        } catch (error) {
                            if (error instanceof SellerBalanceShortError) return { ok: false, reason: 'seller_balance_short', shortCents: error.shortCents };
                            throw error;
                        }
                    },
                },
                { order, lineNos: refundRequest.lineNos, requestId: refundRequest.requestId },
            );
            if (result.ok) return this.createSuccessResponse<StoreRefundResponse>({ refundedCents: result.refundedCents });
            if (result.reason === 'seller_balance_short') return this.createErrorResponse<StoreRefundResponse>(shortBalanceMessage(result.shortCents), 409);
            return this.createErrorResponse<StoreRefundResponse>('These lines were already refunded', 400);
        } catch (error) {
            return this.handleError(error, 'refund a store order') as ControllerResponse<ApiResponse<StoreRefundResponse>>;
        }
    }
}
