import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { TelemetryController } from '../controllers/telemetry/controller';

/** PostHog's config for the browser, the user's analytics setting, and the flags admin view. */
export function setupTelemetryRoutes(app: Hono<AppEnv>): void {
    app.get('/api/telemetry/config', setAuthLevel(AuthConfig.public), adaptController(TelemetryController, TelemetryController.config));
    app.get('/api/user/analytics', setAuthLevel(AuthConfig.authenticated), adaptController(TelemetryController, TelemetryController.getAnalyticsPreference));
    app.put('/api/user/analytics', setAuthLevel(AuthConfig.authenticated), adaptController(TelemetryController, TelemetryController.setAnalyticsPreference));
}
