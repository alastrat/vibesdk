import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { StoreOrdersController } from '../controllers/stores/controller';

/** A store's orders and their refunds, for the app's owner, and the signed-in seller's store limits. */
export function setupStoreRoutes(app: Hono<AppEnv>): void {
    app.get('/api/stores/limits', setAuthLevel(AuthConfig.authenticated), adaptController(StoreOrdersController, StoreOrdersController.limits));
    app.get('/api/stores/:id/orders', setAuthLevel(AuthConfig.ownerOnly), adaptController(StoreOrdersController, StoreOrdersController.list));
    app.post('/api/stores/:id/orders/:orderId/refunds', setAuthLevel(AuthConfig.ownerOnly), adaptController(StoreOrdersController, StoreOrdersController.refund));
}
