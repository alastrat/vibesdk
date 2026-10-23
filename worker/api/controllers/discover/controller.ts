import { msg } from '../../../../shared/i18n/translate';
import type { Context } from 'hono';
import type { AppEnv } from '../../../types/appenv';
import type { DiscoverAccess } from '../../../../shared/types/discover-catalog';
import { DiscoverService } from '../../../database/services/DiscoverService';
import { catalogFilters, DISCOVER_PREVIEW_CSP } from '../../../services/discover/validation';
import { createStripeClient } from '../../../services/payments/stripe-client';
import { fulfillCatalogSession, startCatalogCheckout } from '../../../services/discover/payments';
import { successResponse, errorResponse } from '../../responses';

const service = (c: Context<AppEnv>) => new DiscoverService(c.env.DB);
const privateResponse = <T>(data: T) => { const response = successResponse(data); response.headers.set('Cache-Control','private, no-store'); return response; };

export async function listCatalog(c: Context<AppEnv>): Promise<Response> {
    let filters;
    try { filters = catalogFilters(new URL(c.req.url).searchParams); }
    catch (error) { return errorResponse(error instanceof Error ? error.message : msg('Invalid filters'),400); }
    return successResponse(await service(c).list(filters));
}
export async function catalogCategories(c: Context<AppEnv>): Promise<Response> { return successResponse(await service(c).categories()); }
export async function catalogDetail(c: Context<AppEnv>): Promise<Response> {
    const detail = await service(c).detail(c.req.param('slug') ?? '');
    return detail ? successResponse(detail) : errorResponse(msg('Catalog item not found'),404);
}
export async function catalogMedia(c: Context<AppEnv>): Promise<Response> {
    const asset = await service(c).publicAsset(c.req.param('slug') ?? '',c.req.param('assetId') ?? '');
    if (!asset) return errorResponse(msg('Media not found'),404);
    const object = await c.env.TEMPLATES_BUCKET.get(asset.object_key);
    if (!object) return errorResponse(msg('Media not found'),404);
    const preview = asset.role === 'preview';
    // Roles have fixed content types; imported database MIME values cannot create active content.
    return new Response(object.body, { headers: {
        'Content-Type': preview ? 'text/html; charset=utf-8' : 'image/svg+xml',
        'Content-Security-Policy': preview ? DISCOVER_PREVIEW_CSP : "sandbox; default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'",
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'public, max-age=86400', ETag: `"${asset.sha256}"`,
    } });
}
export async function catalogAccess(c: Context<AppEnv>): Promise<Response> {
    const user = c.get('user');
    if (!user || user.isAnonymous) return errorResponse(msg('Sign in to access source files'),401);
    const db = service(c);
    const entry = await db.entry(c.req.param('slug') ?? '');
    if (!entry) return errorResponse(msg('Catalog item not found'),404);
    const version = await db.entitledVersion(entry,user.id);
    return privateResponse<DiscoverAccess>({ owned: entry.tier === 'premium' && !!version, canDownload: !!version, checkoutEnabled: !!c.env.STRIPE_SECRET_KEY });
}
export async function catalogCheckout(c: Context<AppEnv>): Promise<Response> {
    const user = c.get('user');
    if (!user || user.isAnonymous) return errorResponse(msg('Sign in to purchase'),401);
    if (!c.env.STRIPE_SECRET_KEY) return errorResponse(msg('Catalog checkout is not configured'),503);
    const db = service(c);
    const entry = await db.entry(c.req.param('slug') ?? '');
    if (!entry) return errorResponse(msg('Catalog item not found'),404);
    if (entry.tier !== 'premium') return errorResponse(msg('This item is free to download'),400);
    if (await db.entitledVersion(entry,user.id)) return errorResponse(msg('You already own this item'),409);
    const version = await db.currentVersion(entry);
    if (!version || version.price_cents <= 0 || version.currency !== 'usd') return errorResponse(msg('This item is unavailable'),409);
    const returnUrl = new URL('/discover',c.req.url);
    returnUrl.searchParams.set('item',entry.slug);
    returnUrl.searchParams.set('catalog','1');
    const result = await startCatalogCheckout(db,createStripeClient(c.env.STRIPE_SECRET_KEY),{
        entry,version,userId: user.id,email: user.email,returnUrl: returnUrl.toString(),nowMs: Date.now(),
    });
    if (result.kind === 'owned') return errorResponse(msg('You already own this item. Download its source instead.'),409);
    if (result.kind !== 'checkout') return errorResponse(msg('Your payment is still processing. Please confirm it shortly.'),409);
    return privateResponse({ url: result.url });
}
export async function confirmCatalogCheckout(c: Context<AppEnv>): Promise<Response> {
    const user = c.get('user');
    if (!user || user.isAnonymous) return errorResponse(msg('Sign in to confirm your purchase'),401);
    if (!c.env.STRIPE_SECRET_KEY) return errorResponse(msg('Catalog checkout is not configured'),503);
    let body: unknown;
    try { body = await c.req.json(); } catch { return errorResponse(msg('Invalid checkout confirmation'),400); }
    const sessionId = typeof body === 'object' && body !== null && 'sessionId' in body ? body.sessionId : null;
    if (typeof sessionId !== 'string' || !/^cs_[a-zA-Z0-9_]{1,240}$/.test(sessionId)) return errorResponse(msg('Invalid checkout session'),400);
    const db = service(c);
    const order = await db.orderForSession(sessionId);
    if (!order || order.user_id !== user.id) return errorResponse(msg('Checkout not found'),404);
    const session = await createStripeClient(c.env.STRIPE_SECRET_KEY).retrieveCheckoutSession(sessionId);
    const paid = await fulfillCatalogSession(db,session,user.id);
    if (!paid) return errorResponse(session.payment_status !== 'paid' ? msg('Payment is not complete yet. Try confirming again shortly.') : msg('This checkout could not be verified.'),409);
    return privateResponse<DiscoverAccess>({ owned: true, canDownload: true, checkoutEnabled: true });
}
export async function catalogDownload(c: Context<AppEnv>): Promise<Response> {
    const user = c.get('user');
    if (!user || user.isAnonymous) return errorResponse(msg('Sign in to download'),401);
    const db = service(c);
    const entry = await db.entry(c.req.param('slug') ?? '');
    if (!entry) return errorResponse(msg('Catalog item not found'),404);
    const version = await db.entitledVersion(entry,user.id);
    if (!version) return errorResponse(msg('Purchase this item to download its source'),403);
    const object = await c.env.TEMPLATES_BUCKET.get(version.download_key);
    if (!object) return errorResponse(msg('Download temporarily unavailable'),503);
    return new Response(object.body, { headers: {
        'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${entry.slug}-${version.version}.zip"`,
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
    } });
}
