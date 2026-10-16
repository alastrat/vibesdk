/** Catalog images for stores and shoppers, and catalog operations for admins. */

import { BaseController } from '../baseController';
import type { RouteContext } from '../../types/route-context';
import type { ApiResponse, ControllerResponse } from '../types';

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
}
