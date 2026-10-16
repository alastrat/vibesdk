import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { StripeConnectController } from '../controllers/payments/connectController';
import { handleStripeWebhook } from '../controllers/payments/webhook';

/** Stripe Connect seller onboarding and the Stripe webhook. */
export function setupPaymentsRoutes(app: Hono<AppEnv>): void {
    app.post('/api/stripe/connect/onboarding', setAuthLevel(AuthConfig.authenticated), adaptController(StripeConnectController, StripeConnectController.startOnboarding));
    app.get('/api/stripe/connect/status', setAuthLevel(AuthConfig.authenticated), adaptController(StripeConnectController, StripeConnectController.getStatus));
    app.post('/api/stripe/connect/terms', setAuthLevel(AuthConfig.authenticated), adaptController(StripeConnectController, StripeConnectController.acceptSellerTerms));
    app.post('/api/stripe/connect/dashboard', setAuthLevel(AuthConfig.authenticated), adaptController(StripeConnectController, StripeConnectController.dashboardLink));
    app.post('/api/stripe/webhook', setAuthLevel(AuthConfig.public), (c) => handleStripeWebhook(c.req.raw, c.env));
}
