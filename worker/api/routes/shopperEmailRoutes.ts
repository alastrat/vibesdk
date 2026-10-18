import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { ShopperEmailsController } from '../controllers/shopperEmails/controller';

/** What each store emails its shoppers: the seller's stores, and each store's templates, for its owner. */
export function setupShopperEmailRoutes(app: Hono<AppEnv>): void {
    app.get('/api/emails/stores', setAuthLevel(AuthConfig.authenticated), adaptController(ShopperEmailsController, ShopperEmailsController.stores));
    app.get('/api/stores/:id/emails', setAuthLevel(AuthConfig.ownerOnly), adaptController(ShopperEmailsController, ShopperEmailsController.read));
    app.put('/api/stores/:id/emails-settings', setAuthLevel(AuthConfig.ownerOnly), adaptController(ShopperEmailsController, ShopperEmailsController.saveSettings));
    app.put('/api/stores/:id/emails/:kind', setAuthLevel(AuthConfig.ownerOnly), adaptController(ShopperEmailsController, ShopperEmailsController.saveTemplate));
    app.delete('/api/stores/:id/emails/:kind', setAuthLevel(AuthConfig.ownerOnly), adaptController(ShopperEmailsController, ShopperEmailsController.resetTemplate));
    app.post('/api/stores/:id/emails/:kind/preview', setAuthLevel(AuthConfig.ownerOnly), adaptController(ShopperEmailsController, ShopperEmailsController.preview));
    app.post('/api/stores/:id/emails/:kind/test', setAuthLevel(AuthConfig.ownerOnly), adaptController(ShopperEmailsController, ShopperEmailsController.test));
}
