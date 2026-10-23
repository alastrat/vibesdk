import type { Hono } from 'hono';
import type { AppEnv } from '../../types/appenv';
import { AuthConfig, enforceAuthRequirement, setAuthLevel } from '../../middleware/auth/routeAuth';
import { catalogAccess, catalogCategories, catalogCheckout, catalogDetail, catalogDownload, catalogMedia, confirmCatalogCheckout, listCatalog } from '../controllers/discover/controller';

export function setupDiscoverCatalogRoutes(app: Hono<AppEnv>): void {
    const base = '/api/discover/catalog';
    const publicAccess = setAuthLevel(AuthConfig.public);
    const authenticated = setAuthLevel(AuthConfig.authenticated);
    const enforce = async (c: Parameters<typeof enforceAuthRequirement>[0], next: () => Promise<void>) => {
        const rejected = await enforceAuthRequirement(c);
        if (rejected) return rejected;
        await next();
    };
    app.get(base,publicAccess,listCatalog);
    app.get(`${base}/categories`,publicAccess,catalogCategories);
    app.post(`${base}/checkout/confirm`,authenticated,enforce,confirmCatalogCheckout);
    app.get(`${base}/:slug/access`,authenticated,enforce,catalogAccess);
    app.post(`${base}/:slug/checkout`,authenticated,enforce,catalogCheckout);
    app.get(`${base}/:slug/download`,authenticated,enforce,catalogDownload);
    app.get(`${base}/:slug/media/:assetId`,publicAccess,catalogMedia);
    app.get(`${base}/:slug`,publicAccess,catalogDetail);
}
