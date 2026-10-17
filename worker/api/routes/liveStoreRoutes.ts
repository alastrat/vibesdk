import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { LiveStoreController } from '../controllers/liveStores/controller';

/** A store's live address and its own domain, for the app's owner. */
export function setupLiveStoreRoutes(app: Hono<AppEnv>): void {
    app.get('/api/stores/:id/live', setAuthLevel(AuthConfig.ownerOnly), adaptController(LiveStoreController, LiveStoreController.get));
    app.post('/api/stores/:id/live/publish', setAuthLevel(AuthConfig.ownerOnly), adaptController(LiveStoreController, LiveStoreController.publish));
    app.post('/api/stores/:id/live/offline', setAuthLevel(AuthConfig.ownerOnly), adaptController(LiveStoreController, LiveStoreController.offline));
    app.post('/api/stores/:id/live/domain', setAuthLevel(AuthConfig.ownerOnly), adaptController(LiveStoreController, LiveStoreController.addDomain));
    app.post('/api/stores/:id/live/domain/check', setAuthLevel(AuthConfig.ownerOnly), adaptController(LiveStoreController, LiveStoreController.checkDomain));
    app.delete('/api/stores/:id/live/domain', setAuthLevel(AuthConfig.ownerOnly), adaptController(LiveStoreController, LiveStoreController.removeDomain));
}
