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

	it('thanks the sender and says we will be in touch about the topic they picked', () => {
		expect(email.to).toBe('ana@example.com');
		expect(email.subject).toBe('We got your message');
		expect(email.text).toContain('Thanks for contacting Estori');
		expect(email.text).toContain("We'll be in touch by email soon.");
		expect(email.text).toContain('the Premium plan');
	});

	// Anyone can name any address, so the confirmation must not carry text the sender typed to someone else's inbox.
	it('repeats nothing the sender typed apart from the address it goes to, and has no button or images', () => {
		for (const typed of ['Ana', 'Ruiz', 'North Ridge', 'We run 30 stores']) {
			expect(email.text, typed).not.toContain(typed);
			expect(email.html, typed).not.toContain(typed);
		}
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
		expect(email.html).toContain('Ana &lt;b&gt; Ruiz');
		expect(email.html).not.toContain('<b>');
	});
});
