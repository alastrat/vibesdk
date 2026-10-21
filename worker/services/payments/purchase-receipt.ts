/** The buyer's receipt for a paid site. Estori sends it, since Stripe's own receipts are off. */

import type { StripePurchaseRecord } from '../../database/services/TemplateService';
import { createLogger } from '../../logger';
import { purchaseReceiptEmail } from '../email/templates';
import type { EmailSender } from '../email/types';
import type { Locale } from '../../../shared/i18n/locales';

export interface PurchaseReceiptDeps {
	receiptFacts(appId: string, buyerUserId: string): Promise<{ siteTitle: string | null; buyerEmail: string | null }>;
	sender: EmailSender | null;
	/** Estori's own address, for the site link and policy links; null leaves them out. */
	baseUrl: string | null;
	now(): Date;
	buyerLocale?(userId: string): Promise<Locale | null>;
}

const logger = createLogger('PurchaseReceipt');

/** To the buyer's account email, or the one they gave at checkout. Never throws: the purchase stands either way. */
export async function sendPurchaseReceipt(deps: PurchaseReceiptDeps, purchase: StripePurchaseRecord, checkoutEmail: string | null): Promise<'sent' | 'not-sent'> {
	try {
		if (!deps.sender) return 'not-sent';
		const facts = await deps.receiptFacts(purchase.sourceAppId, purchase.userId);
		const to = facts.buyerEmail ?? checkoutEmail;
		if (!to) {
			logger.warn('A paid site was bought by someone with no email address, so no receipt was sent', { checkoutSessionId: purchase.checkoutSessionId });
			return 'not-sent';
		}
		const locale = await deps.buyerLocale?.(purchase.userId).catch(() => null) ?? 'en';
		await deps.sender.send(
			purchaseReceiptEmail(to, {
				siteTitle: facts.siteTitle,
				amountCents: purchase.priceCents,
				currency: purchase.currency,
				paidAt: deps.now(),
				receiptNumber: purchase.paymentIntentId ?? purchase.checkoutSessionId,
				siteLink: deps.baseUrl ? `${deps.baseUrl}/app/${encodeURIComponent(purchase.sourceAppId)}` : null,
				baseUrl: deps.baseUrl,
			}, locale),
		);
		return 'sent';
	} catch (error) {
		logger.error('Could not send a purchase receipt', { checkoutSessionId: purchase.checkoutSessionId, error });
		return 'not-sent';
	}
}
