import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { PublishingController } from '../controllers/publishing/controller';
import { ReviewAdminController } from '../controllers/publishing/adminController';

/** Publishing, paid listings, purchases, and admin review, moderation and sales. */
export function setupPublishingRoutes(app: Hono<AppEnv>): void {
    // Owner publishing and paid listing
    app.put('/api/apps/:id/visibility', setAuthLevel(AuthConfig.ownerOnly), adaptController(PublishingController, PublishingController.updateVisibility));
    app.get('/api/apps/:id/publishing', setAuthLevel(AuthConfig.ownerOnly), adaptController(PublishingController, PublishingController.getPublishing));
    app.post('/api/apps/:id/paid-listing/versions', setAuthLevel(AuthConfig.ownerOnly), adaptController(PublishingController, PublishingController.submitPaidUpdate));
    app.post('/api/apps/:id/paid-listing/versions/:versionId/withdraw', setAuthLevel(AuthConfig.ownerOnly), adaptController(PublishingController, PublishingController.withdrawPaidVersion));

    // Buyers and creators
    app.post('/api/apps/:id/purchases', setAuthLevel(AuthConfig.authenticated), adaptController(PublishingController, PublishingController.purchase));
    app.post('/api/apps/:id/purchases/confirm', setAuthLevel(AuthConfig.authenticated), adaptController(PublishingController, PublishingController.confirmPurchase));
    app.get('/api/paid-listings/mine', setAuthLevel(AuthConfig.authenticated), adaptController(PublishingController, PublishingController.getMyPaidListings));

    // Admin review and moderation
    app.get('/api/admin/reviews', setAuthLevel(AuthConfig.admin), adaptController(ReviewAdminController, ReviewAdminController.listPending));
    app.get('/api/admin/sales', setAuthLevel(AuthConfig.admin), adaptController(ReviewAdminController, ReviewAdminController.listSales));
    app.get('/api/admin/template-versions/:id/files', setAuthLevel(AuthConfig.admin), adaptController(ReviewAdminController, ReviewAdminController.listVersionFiles));
    app.get('/api/admin/template-versions/:id/file', setAuthLevel(AuthConfig.admin), adaptController(ReviewAdminController, ReviewAdminController.readVersionFile));
    app.get('/api/admin/template-versions/:id/screenshots/:kind', setAuthLevel(AuthConfig.admin), adaptController(ReviewAdminController, ReviewAdminController.serveVersionScreenshot));
    app.post('/api/admin/template-versions/:id/approve', setAuthLevel(AuthConfig.admin), adaptController(ReviewAdminController, ReviewAdminController.approveVersion));
    app.post('/api/admin/template-versions/:id/reject', setAuthLevel(AuthConfig.admin), adaptController(ReviewAdminController, ReviewAdminController.rejectVersion));
    app.put('/api/admin/apps/:id/discover', setAuthLevel(AuthConfig.admin), adaptController(ReviewAdminController, ReviewAdminController.setDiscoverRemoval));
    app.put('/api/admin/apps/:id/showcase', setAuthLevel(AuthConfig.admin), adaptController(ReviewAdminController, ReviewAdminController.setShowcased));
    app.post('/api/admin/showcase-screenshots/refresh', setAuthLevel(AuthConfig.admin), adaptController(ReviewAdminController, ReviewAdminController.refreshShowcaseScreenshots));
}
