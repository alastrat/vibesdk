import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { StoreTranslationsController } from '../controllers/storeTranslations/controller';
import { TasksController } from '../controllers/tasks/controller';

/**
 * Translating a seller's stores, and the background tasks that do it. A store's routes are owner-only; the store list
 * and the tasks belong to the signed-in seller, and a task is looked up by the seller's id, not by an app's owner.
 */
export function setupTranslationRoutes(app: Hono<AppEnv>): void {
    app.get('/api/translations/stores', setAuthLevel(AuthConfig.authenticated), adaptController(StoreTranslationsController, StoreTranslationsController.stores));
    app.get('/api/stores/:id/translations', setAuthLevel(AuthConfig.ownerOnly), adaptController(StoreTranslationsController, StoreTranslationsController.overview));
    app.put('/api/stores/:id/translations/settings', setAuthLevel(AuthConfig.ownerOnly), adaptController(StoreTranslationsController, StoreTranslationsController.saveSettings));
    app.post('/api/stores/:id/translations/:locale/run', setAuthLevel(AuthConfig.ownerOnly), adaptController(StoreTranslationsController, StoreTranslationsController.run));
    app.get('/api/stores/:id/translations/:locale/texts', setAuthLevel(AuthConfig.ownerOnly), adaptController(StoreTranslationsController, StoreTranslationsController.texts));
    app.put('/api/stores/:id/translations/:locale/texts/:hash', setAuthLevel(AuthConfig.ownerOnly), adaptController(StoreTranslationsController, StoreTranslationsController.saveText));
    app.delete('/api/stores/:id/translations/:locale/texts/:hash', setAuthLevel(AuthConfig.ownerOnly), adaptController(StoreTranslationsController, StoreTranslationsController.revertText));

    app.get('/api/tasks', setAuthLevel(AuthConfig.authenticated), adaptController(TasksController, TasksController.list));
    app.post('/api/tasks/:id/cancel', setAuthLevel(AuthConfig.authenticated), adaptController(TasksController, TasksController.cancel));
    app.post('/api/tasks/:id/resume', setAuthLevel(AuthConfig.authenticated), adaptController(TasksController, TasksController.resume));
}
