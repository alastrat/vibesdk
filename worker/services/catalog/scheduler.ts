/** Scheduled catalog work. The refresh runs every 15 minutes in production; admins can run it now. */

import { createLogger } from '../../logger';
import { CatalogOrderService, CatalogProductService, SellerChargeService, StoreOrderService } from '../../database';
import { cjClientFromEnv } from './cj/client';
import { CURATED_PRODUCTS } from './curated';
import { createImageCopier } from './images';
import { refreshCatalogBatch } from './refresh';
import { sweepUnstartedOrders } from './runner';
import { CATALOG_HEALTH_CRON, runCatalogHealth } from './health';
import { platformAlertsFromEnv } from '../alerts/platform-alerts';
import { syncSellerLevelFromEnv } from '../payments/seller-level-sync';

/** Sellers with a store order this recent get their level checked daily, since completed orders and disputes age. */
const LEVEL_CHECK_WINDOW_MS = 120 * 24 * 60 * 60 * 1000;

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
	if (cron === CATALOG_HEALTH_CRON) {
		const products = new CatalogProductService(env);
		const orders = new CatalogOrderService(env);
		const raised = await runCatalogHealth(
			{
				refreshHealth: () => products.refreshHealth(),
				lateItems: (status, before) => orders.lateItems(status, before),
				alert: platformAlertsFromEnv(env),
				unpaidCharges: (before) => new SellerChargeService(env).unpaidSince(before),
			},
			Date.now(),
		);
		if (raised > 0) logger.warn('Catalog health check raised alerts', { raised });
		const sellers = await new StoreOrderService(env).activeSellerIds(new Date(Date.now() - LEVEL_CHECK_WINDOW_MS));
		for (const sellerUserId of sellers) await syncSellerLevelFromEnv(env, sellerUserId);
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

/** Places a catalog order's pending items again, after a won dispute released them. A failure is logged, not thrown. */
export async function restartCatalogPlacement(env: Env, orderId: string): Promise<void> {
	try {
		const namespace = env.CATALOG_ORDER_RUNNER;
		await namespace.get(namespace.idFromName(orderId)).retry(orderId);
	} catch (error) {
		logger.error('Could not restart the catalog order runner', { orderId, error });
	}
}
