import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes/contact.tsx',
		'/src/components/contact/ContactForm.tsx',
		'/src/components/contact/GlobeWalk.tsx',
		'/src/hooks/use-contact.ts',
		'/src/lib/api-client.ts',
		'/src/components/layout/SiteFooter.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

const FORM = '/src/components/contact/ContactForm.tsx';
const PAGE = '/src/routes/contact.tsx';

describe('contact sales page', () => {
	it('puts the pitch and what happens next beside the form, as on 1Password', () => {
		const page = source(PAGE);
		expect(page).toContain('<ContactForm />');
		expect(page).toContain('What happens next');
		expect(page).toContain('lg:grid-cols-2');
	});

	it('asks for the fields the API checks, with the same limits and choices', () => {
		const form = source(FORM);
		for (const name of ['firstName', 'lastName', 'email', 'company', 'companySize', 'topic', 'message']) expect(form, name).toContain(`name="${name}"`);
		expect(form).toContain('maxLength={CONTACT_FIELD_LIMITS.name}');
		expect(form).toContain('maxLength={CONTACT_FIELD_LIMITS.message}');
		expect(form).toContain('COMPANY_SIZES.map');
		expect(form).toContain('CONTACT_TOPICS.map');
		expect(form).toContain('type="email"');
	});

	it('hides a honeypot field from people, keyboards and screen readers', () => {
		const form = source(FORM);
		const honeypot = form.slice(form.indexOf('{/* Honeypot'), form.indexOf('name="website"') + 200);
		expect(honeypot).toContain('aria-hidden');
		expect(honeypot).toContain('tabIndex={-1}');
		expect(honeypot).toContain('autoComplete="off"');
	});

	it('opens on the topic and Premium pool a link asks for', () => {
		expect(source(FORM)).toContain('contactPrefill(location.search)');
	});

	it('sends the form to the API, shows problems inline, and confirms with the address we emailed', () => {
		const form = source(FORM);
		expect(form).toContain('useSubmitContact()');
		expect(form).toContain('role="alert"');
		expect(form).toContain("We've emailed");
		expect(source('/src/hooks/use-contact.ts')).toContain('apiClient.submitContact(');
		// The form shows its own errors, so the client stays quiet.
		expect(source('/src/lib/api-client.ts')).toContain("return this.request<ContactReceivedData>('/api/contact', { method: 'POST', body }, true);");
	});

	it('moves focus to the confirmation, so it scrolls into view and is announced', () => {
		const form = source(FORM);
		const confirmation = form.slice(form.indexOf('if (sent)'), form.indexOf('<CheckCircleIcon'));
		expect(confirmation).toContain('ref={confirmationRef}');
		expect(confirmation).toContain('tabIndex={-1}');
		expect(form).toContain('confirmationRef.current?.focus()');
	});

	it('only mentions the chosen Premium pool while Premium is the topic', () => {
		const form = source(FORM);
		expect(form).toContain("topic === 'premium' && prefill.premiumCredits !== null");
		expect(form).toContain('onChange={(event) => setTopic(event.target.value)}');
	});

	it('shows the walking-to-the-globe band with our own words, not a customer quote', () => {
		const page = source(PAGE);
		expect(page).toContain('<GlobeWalk className=');
		expect(page).toContain('<EstoriLogo className="h-9 w-auto self-start');
		expect(page).toContain('The Estori team');
		expect(page).not.toMatch(/customer review|[“”]/i);
		expect(source('/src/components/contact/GlobeWalk.tsx')).toMatch(/<svg aria-hidden /);
	});

	it('is linked from the footer', () => {
		expect(source('/src/components/layout/SiteFooter.tsx')).toContain("to: '/contact'");
	});
});
