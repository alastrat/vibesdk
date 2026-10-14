import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/components/auth/login-modal.tsx',
		'/src/components/auth/TermsGate.tsx',
		'/src/components/auth/TermsAgreementLabel.tsx',
		'/src/App.tsx',
		'/src/lib/api-client.ts',
	],
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
		expect(modal).toContain('<TermsAgreementLabel');
		expect(modal).toContain('acceptedTermsVersion: TERMS_VERSION');
		expect(modal).toContain('validationErrors.terms');
		expect(modal).not.toContain('By continuing, you agree to our');
	});

	it('takes the missing-agreement message from the shared constant', () => {
		const modal = source('/src/components/auth/login-modal.tsx');
		expect(modal).toContain('errors.terms = TERMS_REQUIRED_MESSAGE;');
		expect(modal).toMatch(/import \{[^}]*TERMS_REQUIRED_MESSAGE[^}]*\} from '@\/api-types'/);
		expect(modal).not.toContain('Agree to the Terms of Service and Privacy Policy to create an account');
	});

	it('words the agreement once and links both documents', () => {
		const label = source('/src/components/auth/TermsAgreementLabel.tsx');
		expect(label).toContain("I'm 18 or older and agree to the");
		expect(label).toContain('href="/terms"');
		expect(label).toContain('href="/privacy"');
		expect(label).toContain('target="_blank"');
		expect(label).toContain('rel="noopener noreferrer"');
		expect(source('/src/components/auth/TermsGate.tsx')).toContain('<TermsAgreementLabel');
		expect(source('/src/components/auth/TermsGate.tsx')).not.toContain("I'm 18 or older");
		expect(source('/src/components/auth/login-modal.tsx')).not.toContain("I'm 18 or older");
	});

	it('shows the window only when the server says the current terms were not agreed to', () => {
		const gate = source('/src/components/auth/TermsGate.tsx');
		expect(gate).toContain('!user.isAnonymous');
		expect(gate).toContain('user.termsAccepted === false');
		expect(gate).toContain('apiClient.acceptTerms(TERMS_VERSION)');
		expect(gate).toContain('refreshUser()');
		expect(gate).toContain('Sign out');
		expect(gate).toContain('showCloseButton={false}');
	});

	it('offers a reload instead of a retry when the terms changed since the page loaded', () => {
		const gate = source('/src/components/auth/TermsGate.tsx');
		expect(gate).toContain('TERMS_OUTDATED_MESSAGE');
		expect(gate).toContain('window.location.reload()');
		expect(gate).toContain('Reload');
		expect(gate).toContain('Try again');
	});

	it('starts every person from an unticked box and stays out of the way on the legal pages', () => {
		const gate = source('/src/components/auth/TermsGate.tsx');
		expect(gate).toContain('key={user.id}');
		expect(gate).toContain('LEGAL_LINKS');
		expect(gate).toContain('useLocation');
	});

	it('mounts the window once, at the app root', () => {
		expect(source('/src/App.tsx')).toContain('<TermsGate />');
		expect(source('/src/lib/api-client.ts')).toContain("'/api/auth/accept-terms'");
	});
});
