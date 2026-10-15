import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { ContactController } from '../controllers/contact/controller';

/** The public contact-sales form, and the admin list of requests. */
export function setupContactRoutes(app: Hono<AppEnv>): void {
    app.post('/api/contact', setAuthLevel(AuthConfig.public), adaptController(ContactController, ContactController.submit));
    app.get('/api/admin/contact-requests', setAuthLevel(AuthConfig.admin), adaptController(ContactController, ContactController.listAll));
}
