import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { SellerOrdersController } from '../controllers/sellerOrders/controller';

/** The signed-in seller's orders across their stores; each controller scopes its reads and writes to that seller. */
export function setupSellerOrderRoutes(app: Hono<AppEnv>): void {
    app.get('/api/orders', setAuthLevel(AuthConfig.authenticated), adaptController(SellerOrdersController, SellerOrdersController.list));
    app.get('/api/orders/:id', setAuthLevel(AuthConfig.authenticated), adaptController(SellerOrdersController, SellerOrdersController.detail));
    app.post('/api/orders/:id/shipment', setAuthLevel(AuthConfig.authenticated), adaptController(SellerOrdersController, SellerOrdersController.shipment));
    app.post('/api/orders/:id/refunds', setAuthLevel(AuthConfig.authenticated), adaptController(SellerOrdersController, SellerOrdersController.refund));
}
