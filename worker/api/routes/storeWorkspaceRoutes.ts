import { Hono } from 'hono';
import type { AppEnv } from '../../types/appenv';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { adaptController } from '../honoAdapter';
import { StoreWorkspaceController } from '../controllers/storeWorkspace/controller';

export function setupStoreWorkspaceRoutes(app: Hono<AppEnv>): void {
	app.get('/api/stores/:id/products', setAuthLevel(AuthConfig.ownerOnly), adaptController(StoreWorkspaceController, StoreWorkspaceController.products));
}
