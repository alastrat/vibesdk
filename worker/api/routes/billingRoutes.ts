import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { BillingController } from '../controllers/billing/controller';

/** The signed-in seller's own plan and billing; every route acts on the caller's account only. */
export function setupBillingRoutes(app: Hono<AppEnv>): void {
    app.get('/api/billing', setAuthLevel(AuthConfig.authenticated), adaptController(BillingController, BillingController.get));
    app.post('/api/billing/checkout', setAuthLevel(AuthConfig.authenticated), adaptController(BillingController, BillingController.checkout));
    app.post('/api/billing/change-plan', setAuthLevel(AuthConfig.authenticated), adaptController(BillingController, BillingController.changePlan));
    app.post('/api/billing/cancel', setAuthLevel(AuthConfig.authenticated), adaptController(BillingController, BillingController.cancel));
    app.post('/api/billing/resume', setAuthLevel(AuthConfig.authenticated), adaptController(BillingController, BillingController.resume));
    app.post('/api/billing/portal', setAuthLevel(AuthConfig.authenticated), adaptController(BillingController, BillingController.portal));
    app.post('/api/billing/credits', setAuthLevel(AuthConfig.authenticated), adaptController(BillingController, BillingController.credits));
}
