import { describe, expect, it } from 'vitest';
import { maskEmail, renderShopperEmail, sampleContent, templateProblem, testOrderNote, trackingUrl, type ShopperEmailContent } from './template';
import { DEFAULT_SHOPPER_EMAIL_TEMPLATES } from '../../../shared/types/shopper-emails';

const CONFIRMATION: ShopperEmailContent = { ...sampleContent('order_confirmation', 'Northwind Tea', 'https://northwind-tea.estori.shop'), customerName: 'Ana <b>Ruiz</b>' };

describe('a seller template', () => {
	it('is refused without a subject or heading, or when a field is too long or the subject has a line break', () => {
		const fields = DEFAULT_SHOPPER_EMAIL_TEMPLATES.order_confirmation;
		expect(templateProblem('order_confirmation', { ...fields, subject: ' ' })).toBe('Add a subject.');
		expect(templateProblem('order_confirmation', { ...fields, heading: '' })).toBe('Add a heading.');
		expect(templateProblem('order_confirmation', { ...fields, body: 'x'.repeat(2001) })).toBe('The message is longer than 2000 characters.');
		expect(templateProblem('order_confirmation', { ...fields, subject: 'Your order\nBcc: someone@example.com' })).toBe('The subject and heading must each be one line.');
		expect(templateProblem('order_confirmation', { ...fields, body: 'Hi\u0007' })).toBe('Remove the hidden control characters.');
	});

	it('names a placeholder the event cannot use, and accepts spaces inside the braces', () => {
		const fields = DEFAULT_SHOPPER_EMAIL_TEMPLATES.order_confirmation;
		expect(templateProblem('order_confirmation', { ...fields, body: 'Tracking: {{tracking_number}}' })).toMatch(/^\{\{tracking_number\}\} isn't a placeholder the order confirmation email can use\. Use \{\{store_name\}\}, /);
		expect(templateProblem('order_shipped', { ...fields, body: 'Tracking: {{ tracking_number }}' })).toBeNull();
		expect(templateProblem('order_confirmation', { ...fields, body: 'Hi {{customer_name' })).toBe("A placeholder in the message isn't closed with }}.");
		expect(templateProblem('order_confirmation', fields)).toBeNull();
	});
});

describe('a rendered shopper email', () => {
	it("fills and escapes placeholders, makes paragraphs, and lists the order's items and total", () => {
		const email = renderShopperEmail({ subject: 'Order #{{order_number}} from {{store_name}}', heading: 'Thanks, {{customer_first_name}}', body: 'First line\nsame paragraph\n\nSecond paragraph' }, CONFIRMATION);
		expect(email.subject).toBe('Order #1042 from Northwind Tea');
		expect(email.html).toContain('Thanks, Ana');
		expect(email.html).toContain('<p style="margin:0 0 16px;">First line<br>same paragraph</p>');
		expect(email.html).toContain('<p style="margin:0 0 16px;">Second paragraph</p>');
		expect(email.html).toContain('2 × Sample product');
		expect(email.html).toContain('$45.99');
		expect(email.html).toContain('Visit Northwind Tea');
		expect(email.text).toContain('Ships to: Austin, TX, US');
		expect(email.text).toContain('Northwind Tea sent you this email about your order #1042. Reply to this email to reach the store.');
		const escaped = renderShopperEmail({ subject: 'Hi {{customer_name}}', heading: 'Hi {{customer_name}}', body: '' }, CONFIRMATION);
		expect(escaped.html).toContain('Hi Ana &lt;b&gt;Ruiz&lt;/b&gt;');
		expect(escaped.html).not.toContain('<b>Ruiz</b>');
	});

	it('shows the carrier and a tracking link when shipped, and the amount when refunded', () => {
		const shipped = renderShopperEmail(DEFAULT_SHOPPER_EMAIL_TEMPLATES.order_shipped, sampleContent('order_shipped', 'Northwind Tea', null));
		expect(shipped.html).toContain('href="https://tools.usps.com/go/TrackConfirmAction?tLabels=9400100000000000000000"');
		expect(shipped.text).toContain('Carrier: USPS');
		expect(shipped.html).not.toContain('Visit Northwind Tea');
		const refund = renderShopperEmail(DEFAULT_SHOPPER_EMAIL_TEMPLATES.refund_issued, sampleContent('refund_issued', 'Northwind Tea', null));
		expect(refund.subject).toBe('A refund for your Northwind Tea order #1042');
		expect(refund.text).toContain("We've refunded $15.00");
		expect(refund.text).toContain('Refunded: $15.00');
	});

	it('marks a test order that came to the seller, and greets a shopper with no name', () => {
		const email = renderShopperEmail(DEFAULT_SHOPPER_EMAIL_TEMPLATES.order_confirmation, { ...CONFIRMATION, customerName: null, testNote: testOrderNote('ana@example.com') });
		expect(email.subject).toBe('[Test] Your Northwind Tea order #1042');
		expect(email.text).toContain("This test order's email came to you instead of the shopper (a***@example.com).");
		expect(email.text).toContain('Thanks for your order, there');
		expect(testOrderNote(null)).toContain('(no email given)');
	});
});

describe('shopper email helpers', () => {
	it('masks an address and links the tracking pages of four carriers', () => {
		expect(maskEmail('ana@example.com')).toBe('a***@example.com');
		expect(maskEmail(null)).toBeNull();
		expect(trackingUrl('UPS', '1Z 999')).toBe('https://www.ups.com/track?tracknum=1Z999');
		expect(trackingUrl('FedEx', '1234')).toBe('https://www.fedex.com/fedextrack/?trknbr=1234');
		expect(trackingUrl('DHL', '55')).toBe('https://www.dhl.com/global-en/home/tracking/tracking-express.html?tracking-id=55');
		expect(trackingUrl('Canada Post', '55')).toBeNull();
	});
});
