import { describe, expect, it } from 'vitest';
import { passwordResetEmail, verifyEmailEmail } from './templates';

const LINK = 'https://estori.app/reset-password?token=abc123';

describe('passwordResetEmail', () => {
	const email = passwordResetEmail('user@example.com', LINK);

	it('is addressed to the user with the reset subject', () => {
		expect(email.to).toBe('user@example.com');
		expect(email.subject).toBe('Reset your Estori password');
	});

	it('carries the link in both parts', () => {
		expect(email.html).toContain(`href="${LINK}"`);
		expect(email.html).toContain(`>${LINK}</`);
		expect(email.text).toContain(LINK);
	});

	it('states the expiry and what to do if it was not requested', () => {
		const sentence = "This link expires in 30 minutes. If you didn't ask to reset your password, ignore this email.";
		expect(email.text).toContain(sentence);
		expect(email.html).toContain("This link expires in 30 minutes. If you didn&#39;t ask to reset your password, ignore this email.");
	});

	it('has no images', () => {
		expect(email.html).not.toContain('<img');
	});
});

describe('verifyEmailEmail', () => {
	const link = 'https://estori.app/verify-email?token=xyz789';
	const email = verifyEmailEmail('user@example.com', link);

	it('is addressed to the user with the confirmation subject', () => {
		expect(email.to).toBe('user@example.com');
		expect(email.subject).toBe('Confirm your email for Estori');
	});

	it('carries the link in both parts', () => {
		expect(email.html).toContain(`href="${link}"`);
		expect(email.html).toContain(`>${link}</`);
		expect(email.text).toContain(link);
	});

	it('states the expiry', () => {
		expect(email.html).toContain('This link expires in 24 hours.');
		expect(email.text).toContain('This link expires in 24 hours.');
	});

	it('has no images', () => {
		expect(email.html).not.toContain('<img');
	});
});

describe('HTML escaping', () => {
	it('escapes ampersands in the link and keeps the text part raw', () => {
		const link = 'https://estori.app/verify-email?token=a&next=b';
		const email = verifyEmailEmail('user@example.com', link);
		expect(email.html).toContain('token=a&amp;next=b');
		expect(email.html).not.toContain('token=a&next=b');
		expect(email.text).toContain(link);
	});

	it('escapes the address in the HTML part', () => {
		const email = passwordResetEmail('a"<b>@example.com', LINK);
		expect(email.html).toContain('a&quot;&lt;b&gt;@example.com');
		expect(email.html).not.toContain('<b>');
		expect(email.to).toBe('a"<b>@example.com');
	});

	it('escapes quotes in the link so it cannot break out of the href', () => {
		const email = passwordResetEmail('user@example.com', 'https://estori.app/x?a="onmouseover="y');
		expect(email.html).not.toContain('"onmouseover="');
		expect(email.html).toContain('&quot;onmouseover=&quot;');
	});
});
