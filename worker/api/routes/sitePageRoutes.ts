import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { SitePageController } from '../controllers/sitePage/controller';

/** Public product pages for Discover sites. */
export function setupSitePageRoutes(app: Hono<AppEnv>): void {
    app.get('/api/discover/:appId', setAuthLevel(AuthConfig.public), adaptController(SitePageController, SitePageController.getPage));
    app.get('/api/discover/:appId/screenshots/:kind', setAuthLevel(AuthConfig.public), adaptController(SitePageController, SitePageController.serveScreenshot));
}
