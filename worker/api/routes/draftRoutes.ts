import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { DraftsController } from '../controllers/drafts/controller';

/** A store's drafts, for the app's owner. */
export function setupDraftRoutes(app: Hono<AppEnv>): void {
    app.get('/api/stores/:id/drafts', setAuthLevel(AuthConfig.ownerOnly), adaptController(DraftsController, DraftsController.list));
    app.post('/api/stores/:id/drafts', setAuthLevel(AuthConfig.ownerOnly), adaptController(DraftsController, DraftsController.create));
    app.post('/api/stores/:id/drafts/:draftId/activate', setAuthLevel(AuthConfig.ownerOnly), adaptController(DraftsController, DraftsController.activate));
    app.patch('/api/stores/:id/drafts/:draftId', setAuthLevel(AuthConfig.ownerOnly), adaptController(DraftsController, DraftsController.rename));
    app.delete('/api/stores/:id/drafts/:draftId', setAuthLevel(AuthConfig.ownerOnly), adaptController(DraftsController, DraftsController.remove));
}
