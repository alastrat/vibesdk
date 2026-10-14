import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/src/components/auth/login-modal.tsx', '/src/components/auth/TermsGate.tsx', '/src/App.tsx', '/src/lib/api-client.ts'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('agreeing to the terms', () => {
	it('asks for agreement in the sign-up form and sends the current version', () => {
		const modal = source('/src/components/auth/login-modal.tsx');
		expect(modal).toContain("I'm 18 or older and agree to the");
		expect(modal).toContain('acceptedTermsVersion: TERMS_VERSION');
		expect(modal).toContain('validationErrors.terms');
		expect(modal).toContain('href="/terms"');
		expect(modal).toContain('href="/privacy"');
		expect(modal).not.toContain('By continuing, you agree to our');
	});

	it('shows the window only when the server says the current terms were not agreed to', () => {
		const gate = source('/src/components/auth/TermsGate.tsx');
		expect(gate).toContain('user.termsAccepted === false');
		expect(gate).toContain('apiClient.acceptTerms(TERMS_VERSION)');
		expect(gate).toContain('refreshUser()');
		expect(gate).toContain('Sign out');
	});

	it('mounts the window once, at the app root', () => {
		expect(source('/src/App.tsx')).toContain('<TermsGate />');
		expect(source('/src/lib/api-client.ts')).toContain("'/api/auth/accept-terms'");
	});
});
