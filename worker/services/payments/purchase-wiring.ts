/** Recording a paid site's purchase, with its production dependencies; the webhook and the return page share it. */

import { TemplateService } from '../../database';
import { configuredBaseUrl } from '../email/links';
import { createEmailSender } from '../email/sender';
import type { FulfillDeps } from './fulfill';
import { sendPurchaseReceipt, type PurchaseReceiptDeps } from './purchase-receipt';

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
		recordStripePurchase: (record) => listings.recordStripePurchase(record),
		sessionRecorded: (checkoutSessionId) => listings.hasCheckoutSession(checkoutSessionId),
		sendReceipt: async (purchase, checkoutEmail) => {
			const sending = sendPurchaseReceipt(receipts, purchase, checkoutEmail);
			if (defer) defer(sending);
			else await sending;
		},
	};
}
