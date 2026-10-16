import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { CatalogController } from '../controllers/catalog/controller';

/** Catalog images (public, for stores and shoppers) and catalog operations (admins). */
export function setupCatalogRoutes(app: Hono<AppEnv>): void {
    app.get('/api/catalog/images/:productId/:file', setAuthLevel(AuthConfig.public), adaptController(CatalogController, CatalogController.serveImage));
}
