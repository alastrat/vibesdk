/** Recording a paid site's purchase, with its production dependencies; the webhook and the return page share it. */

import { StripeConnectService, TemplateService } from '../../database';
import { configuredBaseUrl } from '../email/links';
import { createEmailSender } from '../email/sender';
import { createLogger } from '../../logger';
import { serverAnalytics } from '../posthog/analytics';
import { templateSoldProperties } from '../posthog/commerce-events';
import type { FulfillDeps } from './fulfill';
import { sendPurchaseReceipt, type PurchaseReceiptDeps } from './purchase-receipt';

const logger = createLogger('PurchaseWiring');

/** `defer` sends the receipt after the answer, such as through `ctx.waitUntil`; without it the receipt is awaited. */
export function fulfillDepsFromEnv(env: Env, defer?: (sending: Promise<unknown>) => void): FulfillDeps {
	const listings = new TemplateService(env);
	const receipts: PurchaseReceiptDeps = {
		receiptFacts: (appId, buyerUserId) => listings.receiptFacts(appId, buyerUserId),
		sender: createEmailSender(env),
		baseUrl: configuredBaseUrl(env),
		now: () => new Date(),
	};
	return {
		listingExists: async (listingId) => (await listings.getListing(listingId)) !== null,
		recordStripePurchase: async (record) => {
			const recorded = await listings.recordStripePurchase(record);
			if (recorded) {
				const seller = await new StripeConnectService(env).getByAccountId(record.sellerStripeAccountId).catch((error: unknown) => {
					logger.warn('Could not find the seller of a template sale; template_sold not sent', { sellerStripeAccountId: record.sellerStripeAccountId, error });
					return null;
				});
				if (seller) serverAnalytics(env).capture('template_sold', seller.userId, templateSoldProperties(record));
			}
			return recorded;
		},
		sessionRecorded: (checkoutSessionId) => listings.hasCheckoutSession(checkoutSessionId),
		sendReceipt: async (purchase, checkoutEmail) => {
			const sending = sendPurchaseReceipt(receipts, purchase, checkoutEmail);
			if (defer) defer(sending);
			else await sending;
		},
	};
}
