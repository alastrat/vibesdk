/** Shopper emails with their production dependencies, and their scheduled work. */

import { loadAccount } from '../billing/account';
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
import { storeSenderAddress } from './sender-address';
import { queueShopperEmail, sendDueShopperEmails, type DeferSend, type ShopperEmailDeps, type ShopperEmailEvent } from './outbox';
import { sweepMissedShopperEmails, type ReconcileDeps } from './reconcile';

const logger = createLogger('ShopperEmailsWiring');
/** Sent and failed emails stay on the Emails page this long. */
const KEEP_EMAILS_MS = 90 * 24 * 60 * 60 * 1000;
const DUE_EMAILS_PER_RUN = 100;

/** A store's title, seller email, its own sender address and, while it's live, its address on the stores domain. */
export function shopperEmailStoreFromEnv(env: Env): ShopperEmailDeps['store'] {
	const emails = new ShopperEmailService(env);
	const { storesDomain } = storeHostConfig(env);
	const devPort = devPortOf(env.CUSTOM_DOMAIN);
	const shopperFrom = env.SHOPPER_EMAIL_FROM?.trim() || null;
	return async (appId) => {
		const facts = await emails.storeFacts(appId);
		if (!facts) return null;
		return {
			title: facts.title,
			sellerEmail: facts.sellerEmail,
			sellerEmailConfirmed: facts.sellerEmailConfirmed,
			storeUrl: facts.liveSlug && storesDomain ? storeUrl(`${facts.liveSlug}.${storesDomain}`, devPort) : null,
			fromEmail: storeSenderAddress(facts.slug, shopperFrom),
		};
	};
}

/** The shared sender address: SHOPPER_EMAIL_FROM, else Estori's no-reply address. Stores send from their own address on its domain. */
export function shopperEmailFrom(env: Env): string {
	return env.SHOPPER_EMAIL_FROM?.trim() || EMAIL_FROM.email;
}

export function shopperEmailDepsFromEnv(env: Env): ShopperEmailDeps {
	const orders = new StoreOrderService(env);
	return {
		access: async (userId) => {
			const account = await loadAccount(env, userId);
			return { canSend: !account.billing || account.limits.shopperEmails, canCustomize: !account.billing || account.limits.customShopperEmails };
		},
		emails: new ShopperEmailService(env),
		order: (orderId) => orders.getOrder(orderId),
		store: shopperEmailStoreFromEnv(env),
		sender: createEmailSender(env),
		fromEmail: shopperEmailFrom(env),
		alert: platformAlertsFromEnv(env),
		now: () => new Date(),
		newId: generateId,
	};
}

/** Queues an order event's shopper email and sends it, at once or through `defer`; never throws. */
export function shopperEmailQueueFromEnv(env: Env, defer?: DeferSend): (event: ShopperEmailEvent) => Promise<void> {
	return (event) => queueShopperEmail(shopperEmailDepsFromEnv(env), event, defer);
}

/** Refund and shipment emails from the order's records, sent at once or through `defer`. */
export function shopperEmailReconcileFromEnv(env: Env, defer?: DeferSend): ReconcileDeps {
	return { emails: new ShopperEmailService(env), queue: shopperEmailQueueFromEnv(env, defer), now: () => new Date() };
}

/**
 * Every 15 minutes: refund and shipment emails no event queued are queued, and emails Cloudflare deferred go out
 * again. Daily: emails older than 90 days are forgotten.
 */
export async function runShopperEmailSchedule(cron: string, env: Env): Promise<void> {
	try {
		if (cron === CATALOG_REFRESH_CRON) {
			const checked = await sweepMissedShopperEmails(shopperEmailReconcileFromEnv(env));
			if (checked > 0) logger.info('Queued shopper emails no event queued', { checked });
			const tried = await sendDueShopperEmails(shopperEmailDepsFromEnv(env), DUE_EMAILS_PER_RUN);
			if (tried > 0) logger.info('Sent due shopper emails', { tried });
		} else if (cron === CATALOG_HEALTH_CRON) {
			await new ShopperEmailService(env).prune(new Date(Date.now() - KEEP_EMAILS_MS));
		}
	} catch (error) {
		logger.error('Shopper email schedule failed', { cron, error });
	}
}
