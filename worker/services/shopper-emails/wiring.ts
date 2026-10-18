/** Shopper emails with their production dependencies, and their scheduled work. */

import { ShopperEmailService, StoreOrderService } from '../../database';
import { createLogger } from '../../logger';
import { generateId } from '../../utils/idGenerator';
import { platformAlertsFromEnv } from '../alerts/platform-alerts';
import { CATALOG_HEALTH_CRON } from '../catalog/health';
import { CATALOG_REFRESH_CRON } from '../catalog/scheduler';
import { createEmailSender } from '../email/sender';
import { EMAIL_FROM } from '../email/types';
import { storeHostConfig } from '../live-stores/hosts';
import { devPortOf, storeUrl } from '../live-stores/view';
import { queueShopperEmail, sendDueShopperEmails, type ShopperEmailDeps, type ShopperEmailEvent } from './outbox';

const logger = createLogger('ShopperEmailsWiring');
/** Sent and failed emails stay on the Emails page this long. */
const KEEP_EMAILS_MS = 90 * 24 * 60 * 60 * 1000;
const DUE_EMAILS_PER_RUN = 100;

export function shopperEmailDepsFromEnv(env: Env): ShopperEmailDeps {
	const emails = new ShopperEmailService(env);
	const orders = new StoreOrderService(env);
	const { storesDomain } = storeHostConfig(env);
	const devPort = devPortOf(env.CUSTOM_DOMAIN);
	return {
		emails,
		order: (orderId) => orders.getOrder(orderId),
		store: async (appId) => {
			const facts = await emails.storeFacts(appId);
			if (!facts) return null;
			return { title: facts.title, sellerEmail: facts.sellerEmail, storeUrl: facts.liveSlug && storesDomain ? storeUrl(`${facts.liveSlug}.${storesDomain}`, devPort) : null };
		},
		sender: createEmailSender(env),
		fromEmail: env.SHOPPER_EMAIL_FROM?.trim() || EMAIL_FROM.email,
		alert: platformAlertsFromEnv(env),
		now: () => new Date(),
		newId: generateId,
	};
}

/** Queues an order event's shopper email and tries it at once; never throws. */
export function shopperEmailQueueFromEnv(env: Env): (event: ShopperEmailEvent) => Promise<void> {
	return (event) => queueShopperEmail(shopperEmailDepsFromEnv(env), event);
}

/** Every 15 minutes: emails Cloudflare deferred go out again. Daily: emails older than 90 days are forgotten. */
export async function runShopperEmailSchedule(cron: string, env: Env): Promise<void> {
	try {
		if (cron === CATALOG_REFRESH_CRON) {
			const tried = await sendDueShopperEmails(shopperEmailDepsFromEnv(env), DUE_EMAILS_PER_RUN);
			if (tried > 0) logger.info('Sent due shopper emails', { tried });
		} else if (cron === CATALOG_HEALTH_CRON) {
			await new ShopperEmailService(env).prune(new Date(Date.now() - KEEP_EMAILS_MS));
		}
	} catch (error) {
		logger.error('Shopper email schedule failed', { cron, error });
	}
}
