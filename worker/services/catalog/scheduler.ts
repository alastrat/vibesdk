/** Scheduled catalog work. The refresh runs every 15 minutes in production; admins can run it now. */

import { createLogger } from '../../logger';
import { CatalogOrderService, CatalogProductService } from '../../database';
import { cjClientFromEnv } from './cj/client';
import { CURATED_PRODUCTS } from './curated';
import { createImageCopier } from './images';
import { refreshCatalogBatch } from './refresh';
import { sweepUnstartedOrders } from './runner';

const logger = createLogger('CatalogSchedule');

export const CATALOG_REFRESH_CRON = '*/15 * * * *';

/** Null when the supplier's API key isn't set. */
export async function runCatalogRefresh(env: Env): Promise<{ refreshed: number; failed: number; stoppedForPoints: boolean } | null> {
	const client = cjClientFromEnv(env);
	if (!client) {
		logger.warn('Catalog refresh skipped: CJDROPSHIPPING_API_KEY is not set');
		return null;
	}
	const store = new CatalogProductService(env);
	await store.ensureCurated(CURATED_PRODUCTS, new Date());
	const result = await refreshCatalogBatch({ client, store, images: createImageCopier(env.TEMPLATES_BUCKET), now: () => Date.now() });
	logger.info('Catalog refresh finished', result);
	return result;
}

/** Hourly: the lost hand-off sweep. */
export const CATALOG_SWEEP_CRON = '5 * * * *';

export async function runCatalogSchedule(cron: string, env: Env): Promise<void> {
	if (cron === CATALOG_REFRESH_CRON) await runCatalogRefresh(env);
	if (cron === CATALOG_SWEEP_CRON) {
		const started = await sweepUnstartedOrders(
			{ unstartedOrderIds: (before) => new CatalogOrderService(env).unstartedOrderIds(before), start: (orderId) => scheduleCatalogPlacement(env, orderId) },
			Date.now(),
		);
		if (started > 0) logger.warn('Started catalog orders whose hand-off was lost', { started });
	}
}

/** Starts the order's runner. A failure is logged, not thrown: the paid order is recorded either way. */
export async function scheduleCatalogPlacement(env: Env, orderId: string): Promise<void> {
	try {
		const namespace = env.CATALOG_ORDER_RUNNER;
		await namespace.get(namespace.idFromName(orderId)).start(orderId);
	} catch (error) {
		logger.error('Could not start the catalog order runner', { orderId, error });
	}
}
