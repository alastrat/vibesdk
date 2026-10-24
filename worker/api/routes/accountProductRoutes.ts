import { Hono } from 'hono';
import type { AppEnv } from '../../types/appenv';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { adaptController } from '../honoAdapter';
import { AccountProductsController } from '../controllers/accountProducts/controller';
export function setupAccountProductRoutes(app: Hono<AppEnv>): void {
	const auth = () => setAuthLevel(AuthConfig.authenticated);
	const handler = () =>
		adaptController(
			AccountProductsController,
			AccountProductsController.handle,
		);
	app.post('/api/my-products/assets', auth(), handler());
	app.get('/api/my-products/assets/:assetId', auth(), handler());
	app.get('/api/my-products', auth(), handler());
	app.post('/api/my-products', auth(), handler());
	app.patch('/api/my-products/:productId', auth(), handler());
	app.post('/api/my-products/:productId/archive', auth(), handler());
	app.get('/api/stores/:id/collection', auth(), handler());
	app.post('/api/stores/:id/collection', auth(), handler());
	app.patch('/api/stores/:id/collection/:productId', auth(), handler());
	app.delete('/api/stores/:id/collection/:productId', auth(), handler());
}
