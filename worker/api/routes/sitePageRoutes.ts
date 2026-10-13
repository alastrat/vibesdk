import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { SitePageController } from '../controllers/sitePage/controller';
import { PageCopyDraftController } from '../controllers/sitePage/draftController';

/** Public product pages for Discover sites, and AI drafts of their text for owners. */
export function setupSitePageRoutes(app: Hono<AppEnv>): void {
    app.get('/api/discover/:appId', setAuthLevel(AuthConfig.public), adaptController(SitePageController, SitePageController.getPage));
    app.get('/api/discover/:appId/screenshots/:kind', setAuthLevel(AuthConfig.public), adaptController(SitePageController, SitePageController.serveScreenshot));
    app.post('/api/apps/:id/page-copy/draft', setAuthLevel(AuthConfig.ownerOnly), adaptController(PageCopyDraftController, PageCopyDraftController.draft));
}
