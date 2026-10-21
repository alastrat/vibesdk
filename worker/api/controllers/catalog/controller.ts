import { msg } from '../../../../shared/i18n/translate';
/** Catalog images for stores and shoppers, and catalog operations for admins. */

import { BaseController } from '../baseController';
import type { RouteContext } from '../../types/route-context';
import type { ApiResponse, ControllerResponse } from '../types';
import { runCatalogRefresh } from '../../../services/catalog/scheduler';
import { catalogSupplierMode, paymentModeOf } from '../../../services/catalog/CatalogOrderRunner';
import { cjClientFromEnv } from '../../../services/catalog/cj/client';
import { sandboxMoves } from '../../../services/catalog/sandbox';
import { CatalogOrderAdminService, CatalogOrderService, CatalogProductService } from '../../../database';
import { parseKeysetCursor } from '../../../database/services/keyset-cursor';
import { lateCutoffs, runnerView } from '../../../services/catalog/admin-orders';
import { catalogProductView } from '../../../services/catalog/catalog-view';
import { catalogImagePath } from '../../../services/catalog/images';
import { isAdminCatalogOrderView, type AdminCatalogOrderDetail, type AdminCatalogOrdersData, type CatalogProductsData } from '../../../../shared/types/catalog';

const PRODUCT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FILE = /^[0-9a-f]{16}\.(jpg|jpeg|png|webp)$/;

export class CatalogController extends BaseController {
    static async serveImage(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<never>>> {
        const { productId, file } = context.pathParams;
        if (!productId || !file || !PRODUCT_ID.test(productId) || !FILE.test(file)) {
            return CatalogController.createErrorResponse(msg('Image not found'), 404);
        }
        const object = await env.TEMPLATES_BUCKET.get(`catalog/${productId}/${file}`);
        if (!object?.body) return CatalogController.createErrorResponse(msg('Image not found'), 404);
        // A naked Response: this route is binary, and the router passes it through unchanged.
        return new Response(object.body, {
            headers: {
                'Content-Type': object.httpMetadata?.contentType ?? 'image/jpeg',
                'Cache-Control': 'public, max-age=31536000, immutable',
                'X-Content-Type-Options': 'nosniff',
                'Access-Control-Allow-Origin': '*',
            },
        }) as unknown as ControllerResponse<ApiResponse<never>>;
    }

    /** Runs one catalog refresh now: for local runs and right after curation changes. */
    static async refreshNow(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        _context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<{ refreshed: number; failed: number; stoppedForPoints: boolean }>>> {
        try {
            const result = await runCatalogRefresh(env);
            if (!result) return this.createErrorResponse(msg('The catalog supplier is not configured'), 409);
            return this.createSuccessResponse(result);
        } catch (error) {
            return this.handleError(error, 'refresh the catalog') as ControllerResponse<ApiResponse<{ refreshed: number; failed: number; stoppedForPoints: boolean }>>;
        }
    }

    private static runner(env: Env, orderId: string) {
        return env.CATALOG_ORDER_RUNNER.get(env.CATALOG_ORDER_RUNNER.idFromName(orderId));
    }

    /** Catalog orders for admins, 50 a page: the ones that need someone unless `view=all`. */
    static async listOrders(request: Request, env: Env, _ctx: ExecutionContext, _context: RouteContext): Promise<ControllerResponse<ApiResponse<AdminCatalogOrdersData>>> {
        const params = new URL(request.url).searchParams;
        const view = params.get('view') ?? 'attention';
        const cursor = params.get('cursor');
        if (!isAdminCatalogOrderView(view)) return CatalogController.createErrorResponse(msg('Unknown view'), 400);
        if (cursor && !parseKeysetCursor(cursor)) return CatalogController.createErrorResponse(msg('Invalid cursor'), 400);
        try {
            return CatalogController.createSuccessResponse(await new CatalogOrderAdminService(env).listOrders({ view, late: lateCutoffs(Date.now()), cursor }));
        } catch (error) {
            return CatalogController.handleError(error, 'list catalog orders') as ControllerResponse<ApiResponse<AdminCatalogOrdersData>>;
        }
    }

    /** One catalog order for admins, with where its runner stands; a runner that can't be read leaves that part out. */
    static async orderDetail(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<AdminCatalogOrderDetail>>> {
        const orderId = context.pathParams.id;
        if (!orderId) return CatalogController.createErrorResponse(msg('Missing order id'), 400);
        try {
            const order = await new CatalogOrderAdminService(env).getOrder(orderId);
            if (!order) return CatalogController.createErrorResponse(msg('Order not found'), 404);
            const state = await CatalogController.runner(env, orderId)
                .snapshot()
                .catch(() => null);
            return CatalogController.createSuccessResponse({ ...order, sandbox: catalogSupplierMode(env, order.mode) === 'sandbox', runner: runnerView(state) });
        } catch (error) {
            return CatalogController.handleError(error, 'read a catalog order') as ControllerResponse<ApiResponse<AdminCatalogOrderDetail>>;
        }
    }

    static async runnerSnapshot(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<{ runner: unknown }>>> {
        const orderId = context.pathParams.id;
        if (!orderId) return CatalogController.createErrorResponse(msg('Missing order id'), 400);
        return CatalogController.createSuccessResponse({ runner: await CatalogController.runner(env, orderId).snapshot() });
    }

    static async syncNow(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<{ signalled: true }>>> {
        const orderId = context.pathParams.id;
        if (!orderId) return CatalogController.createErrorResponse(msg('Missing order id'), 400);
        await CatalogController.runner(env, orderId).signal();
        return CatalogController.createSuccessResponse({ signalled: true });
    }

    static async retryOrder(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<{ retried: true }>>> {
        const orderId = context.pathParams.id;
        if (!orderId) return CatalogController.createErrorResponse(msg('Missing order id'), 400);
        await CatalogController.runner(env, orderId).retry(orderId);
        return CatalogController.createSuccessResponse({ retried: true });
    }

    /** Places a catalog order held for a risky payment, after an admin reviewed it. */
    static async releaseOrder(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<{ released: boolean }>>> {
        const orderId = context.pathParams.id;
        if (!orderId) return CatalogController.createErrorResponse(msg('Missing order id'), 400);
        return CatalogController.createSuccessResponse({ released: await CatalogController.runner(env, orderId).release() });
    }

    /** Moves a sandbox supplier order along, for local runs. Refused for live orders. */
    static async sandboxMove(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<{ moved: string[] }>>> {
        try {
            const orderId = context.pathParams.id;
            const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
            const action = body?.action === 'ship' || body?.action === 'deliver' ? body.action : null;
            if (!orderId || !action) return CatalogController.createErrorResponse(msg('Send { action: "ship" | "deliver" }'), 400);
            if (catalogSupplierMode(env, await paymentModeOf(env, orderId)) !== 'sandbox') return CatalogController.createErrorResponse(msg('Only sandbox orders can be moved'), 409);
            const client = cjClientFromEnv(env);
            const order = await new CatalogOrderService(env).getOrder(orderId);
            if (!client || !order) return CatalogController.createErrorResponse(msg('Order not found'), 404);
            const supplierOrderIds = [...new Set(order.items.flatMap((item) => (item.supplierOrderId ? [item.supplierOrderId] : [])))];
            for (const supplierOrderId of supplierOrderIds) {
                // CJ's sandbox finds an order only by its SD order code.
                const code = (await client.getOrderDetail(supplierOrderId))?.cjOrderCode ?? supplierOrderId;
                for (const move of sandboxMoves(action)) {
                    if (move.kind === 'status') await client.sandboxUpdateStatus(code, move.status);
                    else await client.sandboxUpdateTrackNumber(code, `SBX${Date.now()}`);
                }
            }
            await CatalogController.runner(env, orderId).signal();
            return CatalogController.createSuccessResponse({ moved: supplierOrderIds });
        } catch (error) {
            return CatalogController.handleError(error, 'move a sandbox order') as ControllerResponse<ApiResponse<{ moved: string[] }>>;
        }
    }

    static async listProducts(request: Request, env: Env, _ctx: ExecutionContext, _context: RouteContext): Promise<ControllerResponse<ApiResponse<CatalogProductsData>>> {
        try {
            const query = new URL(request.url).searchParams.get('q');
            const rows = await new CatalogProductService(env).catalogRows({ query, productId: null, limit: 50 });
            const now = Date.now();
            const products = rows.flatMap((row) => catalogProductView(row, catalogImagePath, now) ?? []);
            return CatalogController.createSuccessResponse<CatalogProductsData>({ products });
        } catch (error) {
            return CatalogController.handleError(error, 'list catalog products') as ControllerResponse<ApiResponse<CatalogProductsData>>;
        }
    }
}
