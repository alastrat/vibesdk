import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { CatalogController } from '../controllers/catalog/controller';

/** Catalog images (public, for stores and shoppers) and catalog operations (admins). */
export function setupCatalogRoutes(app: Hono<AppEnv>): void {
    app.get('/api/catalog/products', setAuthLevel(AuthConfig.authenticated), adaptController(CatalogController, CatalogController.listProducts));
    app.get('/api/catalog/images/:productId/:file', setAuthLevel(AuthConfig.public), adaptController(CatalogController, CatalogController.serveImage));
    app.post('/api/admin/catalog/refresh', setAuthLevel(AuthConfig.admin), adaptController(CatalogController, CatalogController.refreshNow));
    app.get('/api/admin/catalog/orders/:id/runner', setAuthLevel(AuthConfig.admin), adaptController(CatalogController, CatalogController.runnerSnapshot));
    app.post('/api/admin/catalog/orders/:id/sync', setAuthLevel(AuthConfig.admin), adaptController(CatalogController, CatalogController.syncNow));
    app.post('/api/admin/catalog/orders/:id/retry', setAuthLevel(AuthConfig.admin), adaptController(CatalogController, CatalogController.retryOrder));
    app.post('/api/admin/catalog/orders/:id/sandbox', setAuthLevel(AuthConfig.admin), adaptController(CatalogController, CatalogController.sandboxMove));
}
