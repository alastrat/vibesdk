import { describe, expect, it } from 'vitest';
import { sendPurchaseReceipt, type PurchaseReceiptDeps } from './purchase-receipt';
import type { StripePurchaseRecord } from '../../database/services/TemplateService';
import type { OutgoingEmail } from '../email/types';

const PURCHASE: StripePurchaseRecord = {
	listingId: 'l1',
	sourceAppId: 'app1',
	versionId: 'v2',
	userId: 'buyer1',
	priceCents: 2900,
	platformFeeCents: 263,
	sellerAmountCents: 2637,
	currency: 'usd',
	checkoutSessionId: 'cs_1',
	paymentIntentId: 'pi_1',
	sellerStripeAccountId: 'acct_1',
};

function world(input: { buyerEmail?: string | null; siteTitle?: string | null; sendFails?: boolean; noSender?: boolean } = {}) {
	const sent: OutgoingEmail[] = [];
	const deps: PurchaseReceiptDeps = {
		receiptFacts: async () => ({ siteTitle: input.siteTitle === undefined ? 'Bakery Landing Page' : input.siteTitle, buyerEmail: input.buyerEmail === undefined ? 'buyer@example.com' : input.buyerEmail }),
		sender: input.noSender
			? null
			: {
					send: async (email) => {
						if (input.sendFails) throw new Error('E_DELIVERY_FAILED');
						sent.push(email);
					},
				},
		baseUrl: 'https://estori.app',
		now: () => new Date('2026-10-18T15:30:00Z'),
	};
	return { deps, sent };
}

describe('sendPurchaseReceipt', () => {
	it("emails the buyer's account address a receipt for the site, linking to it, numbered by the Stripe payment", async () => {
		const { deps, sent } = world();
		expect(await sendPurchaseReceipt(deps, PURCHASE, 'checkout@example.com')).toBe('sent');
		expect(sent[0]).toMatchObject({ to: 'buyer@example.com', subject: 'Your Estori receipt: Bakery Landing Page' });
		expect(sent[0].text).toContain('https://estori.app/app/app1');
		expect(sent[0].text).toContain('Receipt number: pi_1');
	});

	it('uses the email given at checkout when the account has none, and the session when Stripe gave no payment', async () => {
		const { deps, sent } = world({ buyerEmail: null });
		await sendPurchaseReceipt(deps, { ...PURCHASE, paymentIntentId: null }, 'checkout@example.com');
		expect(sent[0].to).toBe('checkout@example.com');
		expect(sent[0].text).toContain('Receipt number: cs_1');
	});

	it('sends nothing without an address or a sender, and never throws when sending fails', async () => {
		const nobody = world({ buyerEmail: null });
		expect(await sendPurchaseReceipt(nobody.deps, PURCHASE, null)).toBe('not-sent');
		expect(nobody.sent).toEqual([]);
		expect(await sendPurchaseReceipt(world({ noSender: true }).deps, PURCHASE, null)).toBe('not-sent');
		await expect(sendPurchaseReceipt(world({ sendFails: true }).deps, PURCHASE, null)).resolves.toBe('not-sent');
	});
});
