import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { TemplatesController } from '../controllers/templates/controller';

/**
 * Template routes: creator actions on an app, the public gallery and purchases.
 * `/api/templates/mine` is registered before `/api/templates/:slug`.
 */
export function setupTemplateRoutes(app: Hono<AppEnv>): void {
    // Creator actions on one of their apps
    app.get('/api/apps/:id/template', setAuthLevel(AuthConfig.ownerOnly), adaptController(TemplatesController, TemplatesController.getAppTemplate));
    app.post('/api/apps/:id/template-submissions', setAuthLevel(AuthConfig.ownerOnly), adaptController(TemplatesController, TemplatesController.submitTemplate));

    // Creator and buyer actions on a template
    app.get('/api/templates/mine', setAuthLevel(AuthConfig.authenticated), adaptController(TemplatesController, TemplatesController.getMyTemplates));
    app.post('/api/templates/:id/versions/:versionId/withdraw', setAuthLevel(AuthConfig.authenticated), adaptController(TemplatesController, TemplatesController.withdrawVersion));
    app.put('/api/templates/:id/listing', setAuthLevel(AuthConfig.authenticated), adaptController(TemplatesController, TemplatesController.setListing));
    app.post('/api/templates/:id/purchases', setAuthLevel(AuthConfig.authenticated), adaptController(TemplatesController, TemplatesController.purchaseTemplate));

    // Public gallery
    app.get('/api/templates', setAuthLevel(AuthConfig.public), adaptController(TemplatesController, TemplatesController.listTemplates));
    app.get('/api/templates/:id/screenshots/:kind', setAuthLevel(AuthConfig.public), adaptController(TemplatesController, TemplatesController.serveScreenshot));
    app.get('/api/templates/:slug', setAuthLevel(AuthConfig.public), adaptController(TemplatesController, TemplatesController.getTemplate));
}
