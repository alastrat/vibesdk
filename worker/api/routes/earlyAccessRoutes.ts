import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { EarlyAccessController } from '../controllers/earlyAccess/controller';

/** Early-access requests for upcoming programs, and the admin list of who asked. */
export function setupEarlyAccessRoutes(app: Hono<AppEnv>): void {
    app.post('/api/early-access', setAuthLevel(AuthConfig.authenticated), adaptController(EarlyAccessController, EarlyAccessController.request));
    app.get('/api/early-access', setAuthLevel(AuthConfig.authenticated), adaptController(EarlyAccessController, EarlyAccessController.mine));
    app.get('/api/admin/early-access', setAuthLevel(AuthConfig.admin), adaptController(EarlyAccessController, EarlyAccessController.listAll));
}
