/** Scheduled catalog work. The refresh runs every 15 minutes in production; admins can run it now. */

import { createLogger } from '../../logger';
import { CatalogProductService } from '../../database';
import { cjClientFromEnv } from './cj/client';
import { CURATED_PRODUCTS } from './curated';
import { createImageCopier } from './images';
import { refreshCatalogBatch } from './refresh';

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

export async function runCatalogSchedule(cron: string, env: Env): Promise<void> {
	if (cron === CATALOG_REFRESH_CRON) await runCatalogRefresh(env);
}
