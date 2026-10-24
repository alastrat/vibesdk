import { Hono } from 'hono';
import type { AppEnv } from '../../types/appenv';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { adaptController } from '../honoAdapter';
import { StoreAnalyticsController } from '../controllers/storeWorkspace/analytics';
import { StoreWorkspaceController } from '../controllers/storeWorkspace/controller';

export function setupStoreWorkspaceRoutes(app: Hono<AppEnv>): void {
	app.get('/api/stores/:id/analytics/live', setAuthLevel(AuthConfig.ownerOnly), adaptController(StoreAnalyticsController, StoreAnalyticsController.live));
	app.get('/api/stores/:id/analytics', setAuthLevel(AuthConfig.ownerOnly), adaptController(StoreAnalyticsController, StoreAnalyticsController.analytics));
	app.get('/api/stores/:id/products', setAuthLevel(AuthConfig.ownerOnly), adaptController(StoreWorkspaceController, StoreWorkspaceController.products));
}
