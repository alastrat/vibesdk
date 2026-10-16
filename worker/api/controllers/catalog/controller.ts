/** Catalog images for stores and shoppers, and catalog operations for admins. */

import { BaseController } from '../baseController';
import type { RouteContext } from '../../types/route-context';
import type { ApiResponse, ControllerResponse } from '../types';
import { runCatalogRefresh } from '../../../services/catalog/scheduler';
import { catalogSupplierMode } from '../../../services/catalog/CatalogOrderRunner';
import { cjClientFromEnv } from '../../../services/catalog/cj/client';
import { sandboxMoves } from '../../../services/catalog/sandbox';
import { CatalogOrderService } from '../../../database';

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
            return CatalogController.createErrorResponse('Image not found', 404);
        }
        const object = await env.TEMPLATES_BUCKET.get(`catalog/${productId}/${file}`);
        if (!object?.body) return CatalogController.createErrorResponse('Image not found', 404);
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
            if (!result) return this.createErrorResponse('The catalog supplier is not configured', 409);
            return this.createSuccessResponse(result);
        } catch (error) {
            return this.handleError(error, 'refresh the catalog') as ControllerResponse<ApiResponse<{ refreshed: number; failed: number; stoppedForPoints: boolean }>>;
        }
    }

    private static runner(env: Env, orderId: string) {
        return env.CATALOG_ORDER_RUNNER.get(env.CATALOG_ORDER_RUNNER.idFromName(orderId));
    }

    static async runnerSnapshot(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<{ runner: unknown }>>> {
        const orderId = context.pathParams.id;
        if (!orderId) return CatalogController.createErrorResponse('Missing order id', 400);
        return CatalogController.createSuccessResponse({ runner: await CatalogController.runner(env, orderId).snapshot() });
    }

    static async syncNow(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<{ signalled: true }>>> {
        const orderId = context.pathParams.id;
        if (!orderId) return CatalogController.createErrorResponse('Missing order id', 400);
        await CatalogController.runner(env, orderId).signal();
        return CatalogController.createSuccessResponse({ signalled: true });
    }

    static async retryOrder(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<{ retried: true }>>> {
        const orderId = context.pathParams.id;
        if (!orderId) return CatalogController.createErrorResponse('Missing order id', 400);
        await CatalogController.runner(env, orderId).retry();
        return CatalogController.createSuccessResponse({ retried: true });
    }

    /** Moves a sandbox supplier order along, for local runs. Refused for live orders. */
    static async sandboxMove(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<{ moved: string[] }>>> {
        try {
            const orderId = context.pathParams.id;
            const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
            const action = body?.action === 'ship' || body?.action === 'deliver' ? body.action : null;
            if (!orderId || !action) return CatalogController.createErrorResponse('Send { action: "ship" | "deliver" }', 400);
            if (catalogSupplierMode(env) !== 'sandbox') return CatalogController.createErrorResponse('Only sandbox orders can be moved', 409);
            const client = cjClientFromEnv(env);
            const order = await new CatalogOrderService(env).getOrder(orderId);
            if (!client || !order) return CatalogController.createErrorResponse('Order not found', 404);
            const supplierOrderIds = [...new Set(order.items.flatMap((item) => (item.supplierOrderId ? [item.supplierOrderId] : [])))];
            for (const supplierOrderId of supplierOrderIds) {
                for (const move of sandboxMoves(action)) {
                    if (move.kind === 'status') await client.sandboxUpdateStatus(supplierOrderId, move.status);
                    else await client.sandboxUpdateTrackNumber(supplierOrderId, `SBX${Date.now()}`);
                }
            }
            await CatalogController.runner(env, orderId).signal();
            return CatalogController.createSuccessResponse({ moved: supplierOrderIds });
        } catch (error) {
            return CatalogController.handleError(error, 'move a sandbox order') as ControllerResponse<ApiResponse<{ moved: string[] }>>;
        }
    }
}
