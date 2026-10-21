import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { BillingController } from '../controllers/billing/controller';
import { BillingAdminController } from '../controllers/admin/billing';

/** The signed-in seller's own plan and billing, acting on the caller's account only; then the admin routes, which act on the account in the path. */
export function setupBillingRoutes(app: Hono<AppEnv>): void {
    app.get('/api/billing', setAuthLevel(AuthConfig.authenticated), adaptController(BillingController, BillingController.get));
    app.post('/api/billing/checkout', setAuthLevel(AuthConfig.authenticated), adaptController(BillingController, BillingController.checkout));
    app.post('/api/billing/credits', setAuthLevel(AuthConfig.authenticated), adaptController(BillingController, BillingController.credits));
    app.get('/api/billing/checkout/terms', setAuthLevel(AuthConfig.authenticated), adaptController(BillingController, BillingController.checkoutTerms));
    app.post('/api/billing/checkout/consent', setAuthLevel(AuthConfig.authenticated), adaptController(BillingController, BillingController.checkoutConsent));
    app.get('/api/billing/checkout/status', setAuthLevel(AuthConfig.authenticated), adaptController(BillingController, BillingController.checkoutStatus));
    app.post('/api/billing/change-plan', setAuthLevel(AuthConfig.authenticated), adaptController(BillingController, BillingController.changePlan));
    app.post('/api/billing/cancel', setAuthLevel(AuthConfig.authenticated), adaptController(BillingController, BillingController.cancel));
    app.post('/api/billing/resume', setAuthLevel(AuthConfig.authenticated), adaptController(BillingController, BillingController.resume));
    app.post('/api/billing/card', setAuthLevel(AuthConfig.authenticated), adaptController(BillingController, BillingController.cardSetup));
    app.post('/api/billing/card/complete', setAuthLevel(AuthConfig.authenticated), adaptController(BillingController, BillingController.cardComplete));
    app.post('/api/billing/invoices/pay', setAuthLevel(AuthConfig.authenticated), adaptController(BillingController, BillingController.payInvoice));
    app.get('/api/billing/history', setAuthLevel(AuthConfig.authenticated), adaptController(BillingController, BillingController.history));
    app.get('/api/billing/invoices/:id/pdf', setAuthLevel(AuthConfig.authenticated), adaptController(BillingController, BillingController.invoicePdf));
    app.get('/api/admin/users/:userId/billing', setAuthLevel(AuthConfig.admin), adaptController(BillingAdminController, BillingAdminController.get));
    app.put('/api/admin/users/:userId/plan', setAuthLevel(AuthConfig.admin), adaptController(BillingAdminController, BillingAdminController.setPlan));
    app.post('/api/admin/users/:userId/credits', setAuthLevel(AuthConfig.admin), adaptController(BillingAdminController, BillingAdminController.grantCredits));
    app.put('/api/admin/users/:userId/stripe-customer', setAuthLevel(AuthConfig.admin), adaptController(BillingAdminController, BillingAdminController.linkTestCustomer));
}
