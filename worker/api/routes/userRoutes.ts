import { UserController } from '../controllers/user/controller';
import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';

/**
 * Setup user management routes
 */
export function setupUserRoutes(app: Hono<AppEnv>): void {
    // User apps with pagination (this is what the frontend needs)
    app.get('/api/user/apps', setAuthLevel(AuthConfig.authenticated), adaptController(UserController, UserController.getApps));

    // User profile
    app.put('/api/user/profile', setAuthLevel(AuthConfig.authenticated), adaptController(UserController, UserController.updateProfile));

    // The language the user chose for the app and for the emails sent to them
    app.put('/api/user/locale', setAuthLevel(AuthConfig.authenticated), adaptController(UserController, UserController.setLocale));
}