import { describe, expect, it } from 'vitest';
import type { ContactRequestInput } from '../../../shared/types/contact';
import { contactNotificationEmail, contactReceivedEmail } from './templates';

const REQUEST: ContactRequestInput = {
	firstName: 'Ana <b>',
	lastName: 'Ruiz',
	email: 'ana@example.com',
	company: 'North Ridge & Co',
	companySize: '2–10',
	topic: 'premium',
	message: 'We run 30 stores.\nCan you help?',
	premiumCredits: 50_000,
};

describe('contactReceivedEmail', () => {
	const email = contactReceivedEmail(REQUEST);

	it('thanks the sender by name and says we will be in touch', () => {
		expect(email.to).toBe('ana@example.com');
		expect(email.subject).toBe('We got your message');
		expect(email.text).toContain('Thanks, Ana <b>');
		expect(email.text).toContain("We'll be in touch by email soon.");
		expect(email.text).toContain('the Premium plan');
	});

	it('escapes what the sender typed and has no button or images', () => {
		expect(email.html).toContain('Thanks, Ana &lt;b&gt;');
		expect(email.html).not.toContain('<b>');
		expect(email.html).not.toContain('<a href');
		expect(email.html).not.toContain('<img');
	});
});

describe('contactNotificationEmail', () => {
	const email = contactNotificationEmail('sales@estori.app', REQUEST);

	it('tells the team who wrote and about what', () => {
		expect(email.to).toBe('sales@estori.app');
		expect(email.subject).toBe('New contact request: North Ridge & Co (the Premium plan)');
		for (const value of ['Ana <b> Ruiz', 'ana@example.com', 'North Ridge & Co', '2–10', '50,000 credits a month', 'We run 30 stores.']) {
			expect(email.text, value).toContain(value);
		}
		expect(email.html).toContain('North Ridge &amp; Co');
	});
});
