import { describe, expect, it } from 'vitest';
import { purchaseReceiptEmail, type PurchaseReceipt } from './templates';

const RECEIPT: PurchaseReceipt = {
	siteTitle: 'Bakery Landing Page',
	amountCents: 2900,
	currency: 'usd',
	paidAt: new Date('2026-10-18T15:30:00Z'),
	receiptNumber: 'pi_3Q1',
	siteLink: 'https://estori.app/app/app_1',
	baseUrl: 'https://estori.app',
};

describe('purchaseReceiptEmail', () => {
	const email = purchaseReceiptEmail('buyer@example.com', RECEIPT);

	it('is the buyer\'s receipt for the site, with what they paid, when and the payment to find it by', () => {
		expect(email.to).toBe('buyer@example.com');
		expect(email.subject).toBe('Your Estori receipt: Bakery Landing Page');
		for (const part of ['Site: Bakery Landing Page', 'Amount paid: $29.00 USD', 'Date: October 18, 2026', 'Receipt number: pi_3Q1']) expect(email.text).toContain(part);
	});

	it('links to the site to make a copy, and states what the license allows', () => {
		expect(email.html).toContain('href="https://estori.app/app/app_1"');
		expect(email.text).toContain('Make your copy: https://estori.app/app/app_1');
		expect(email.text).toContain("can't be resold");
	});

	it('names Globalink as the seller, with its address, support, and the refund and privacy policies', () => {
		for (const part of ['Globalink Commerce Technologies LLC', '206 Gray Street, Unit 3112, Houston, TX 77002', 'support@estori.app', 'within 14 days', 'https://estori.app/refunds', 'https://estori.app/privacy']) {
			expect(email.text, part).toContain(part);
		}
	});

	it('stays plain ASCII outside the seller-written title, so no client garbles it', () => {
		expect(/^[\x00-\x7F]*$/.test(email.html)).toBe(true);
	});

	it('keeps a site title to one escaped line, and leaves out links without a configured domain', () => {
		const plain = purchaseReceiptEmail('buyer@example.com', { ...RECEIPT, siteTitle: '<b>Cafe</b>\r\nBcc: x@example.com', siteLink: null, baseUrl: null });
		expect(plain.subject).toBe('Your Estori receipt: <b>Cafe</b> Bcc: x@example.com');
		expect(plain.html).toContain('&lt;b&gt;Cafe&lt;/b&gt;');
		expect(plain.html).not.toContain('<b>Cafe');
		expect(plain.text).not.toContain('Make your copy');
		expect(plain.text).not.toContain('/refunds');
		expect(purchaseReceiptEmail('buyer@example.com', { ...RECEIPT, siteTitle: '  ' }).subject).toBe('Your Estori receipt: your site');
	});
});
