import { describe, expect, it } from 'vitest';
import {
	CONFIRM_LINK_INVALID_MESSAGE,
	FORGOT_PASSWORD_MESSAGE,
	RESET_LINK_INVALID_MESSAGE,
	RESET_PASSWORD_PATH,
	VERIFY_EMAIL_PATH,
} from '../../shared/types/account-email';

const sources = import.meta.glob<string>(
	[
		'/src/routes.tsx',
		'/src/api-types.ts',
		'/src/lib/api-client.ts',
		'/src/lib/auth-validation.ts',
		'/src/contexts/auth-context.tsx',
		'/src/components/auth/login-modal.tsx',
		'/src/components/auth/AuthModalProvider.tsx',
		'/src/components/auth/TermsGate.tsx',
		'/src/routes/auth/ResetPasswordPage.tsx',
		'/src/routes/auth/VerifyEmailPage.tsx',
		'/src/routes/auth/AccountEmailCard.tsx',
		'/src/routes/settings/index.tsx',
		'/worker/services/email/links.ts',
		'/worker/services/auth/one-time-token.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

function occurrences(text: string, needle: string): number {
	return text.split(needle).length - 1;
}

describe('account email pages', () => {
	it('words the answers exactly as agreed, in one place shared with the server', () => {
		expect(FORGOT_PASSWORD_MESSAGE).toBe(
			"If an account exists for that email, we've sent a link to reset your password. It expires in 30 minutes.",
		);
		expect(RESET_LINK_INVALID_MESSAGE).toBe('This reset link is invalid or has expired.');
		expect(CONFIRM_LINK_INVALID_MESSAGE).toBe('This confirmation link is invalid or has expired.');
		expect(RESET_PASSWORD_PATH).toBe('/reset-password');
		expect(VERIFY_EMAIL_PATH).toBe('/verify-email');

		const tokens = source('/worker/services/auth/one-time-token.ts');
		expect(tokens).toContain('shared/types/account-email');
		expect(tokens).not.toContain("'This reset link is invalid or has expired.'");
		const links = source('/worker/services/email/links.ts');
		expect(links).toContain('RESET_PASSWORD_PATH');
		expect(links).toContain('VERIFY_EMAIL_PATH');

		const apiTypes = source('/src/api-types.ts');
		for (const name of ['RESET_LINK_INVALID_MESSAGE', 'CONFIRM_LINK_INVALID_MESSAGE', 'RESET_PASSWORD_PATH', 'VERIFY_EMAIL_PATH']) {
			expect(apiTypes).toContain(name);
		}
	});

	it('serves the reset and confirm pages in the public layout, open to everyone', () => {
		const routes = source('/src/routes.tsx');
		const publicBlock = routes.slice(routes.indexOf('Component: PublicShell'));
		expect(publicBlock).toContain("path: 'reset-password'");
		expect(publicBlock).toContain("path: 'verify-email'");
		expect(publicBlock).toContain('ResetPasswordPage');
		expect(publicBlock).toContain('VerifyEmailPage');
		expect(publicBlock).not.toContain('ProtectedRoute');
		const appBlock = routes.slice(routes.indexOf('Component: AppShell'), routes.indexOf('Component: PublicShell'));
		expect(appBlock).not.toContain('reset-password');
		expect(appBlock).not.toContain('verify-email');
	});

	it('calls each account email endpoint from the API client', () => {
		const client = source('/src/lib/api-client.ts');
		for (const endpoint of [
			"'/api/auth/forgot-password'",
			"'/api/auth/reset-password'",
			"'/api/auth/verify-email'",
			"'/api/auth/resend-verification'",
		]) {
			expect(client).toContain(endpoint);
		}
		for (const method of ['async forgotPassword(', 'async resetPassword(', 'async verifyEmail(', 'async resendVerification(']) {
			expect(client).toContain(method);
		}
		expect(source('/src/api-types.ts')).toContain('emailSending: boolean');
		expect(source('/src/contexts/auth-context.tsx')).toContain('emailSending');
	});

	it('offers "Forgot password?" in the sign-in view only when the server can send email', () => {
		const modal = source('/src/components/auth/login-modal.tsx');
		expect(modal).toContain('Forgot password?');
		expect(modal).toContain('authProviders?.emailSending');
		expect(modal).toContain("mode === 'login' && canResetPassword");
	});

	it('asks for a reset link in the same window and shows the server answer in place of the form', () => {
		const modal = source('/src/components/auth/login-modal.tsx');
		expect(modal).toContain("'forgot'");
		expect(modal).toContain('Reset your password');
		expect(modal).toContain('Send reset link');
		expect(modal).toContain('Back to sign in');
		expect(modal).toContain('apiClient.forgotPassword(');
		expect(modal).toContain('response.data.message');
	});

	it('can open the window directly in forgot mode without changing the existing call signature', () => {
		const provider = source('/src/components/auth/AuthModalProvider.tsx');
		expect(provider).toContain('showAuthModal: (context?: string, onSuccess?: () => void, intendedUrl?: string, options?: ShowAuthModalOptions) => void;');
		expect(provider).toContain('initialMode');
		expect(source('/src/components/auth/login-modal.tsx')).toContain('initialMode');
	});

	it('resets the password through the API and shows both outcomes', () => {
		const page = source('/src/routes/auth/ResetPasswordPage.tsx');
		expect(page).toContain('apiClient.resetPassword(');
		expect(page).toContain('Your password is updated. Sign in with your new password.');
		expect(page).toContain('RESET_LINK_INVALID_MESSAGE');
		expect(page).toContain('Request a new link');
		expect(page).toContain("initialMode: 'forgot'");
		expect(page).toContain('showAuthModal()');
		expect(page).toContain("searchParams.get('token')");
		expect(page).toContain("pageTitle('Reset password')");
		expect(page).toContain('refreshUser');
	});

	it('checks a new password with the same rules as sign-up, defined once', () => {
		const rules = source('/src/lib/auth-validation.ts');
		const modal = source('/src/components/auth/login-modal.tsx');
		const page = source('/src/routes/auth/ResetPasswordPage.tsx');
		expect(rules).toContain('export function newPasswordErrors');
		expect(modal).toContain('newPasswordErrors(');
		expect(page).toContain('newPasswordErrors(');
		for (const text of [modal, page]) {
			expect(text).toContain("from '@/lib/auth-validation'");
			expect(text).not.toContain('(?=.*[a-z])');
			expect(text).not.toContain('Password must include at least one uppercase letter');
		}
	});

	it('confirms the email only when the visitor clicks, once, and shows both outcomes', () => {
		const page = source('/src/routes/auth/VerifyEmailPage.tsx');
		// Link scanners open pages without clicking, so nothing may post the token on load.
		expect(page).not.toContain('useEffect');
		expect(page).toContain('Confirm my email');
		expect(page).toContain('Only confirm if you created an Estori account with this address.');
		expect(occurrences(page, 'apiClient.verifyEmail(')).toBe(1);

		const handlerStart = page.indexOf('const confirm = useCallback(');
		expect(handlerStart).toBeGreaterThan(-1);
		const handler = page.slice(handlerStart, page.indexOf('\n\n', handlerStart));
		expect(handler).toContain('apiClient.verifyEmail(token)');
		expect(handler).toMatch(/if \(!token \|\| pending\.current\) return;\s*pending\.current = true;/);
		expect(page).toContain('useRef');

		const button = page.slice(page.lastIndexOf('<OrangeButton', page.indexOf('Confirm my email')), page.indexOf('Confirm my email'));
		expect(button).toContain('onClick={() => void confirm()}');
		expect(button).toContain("disabled={state.status === 'confirming'}");

		expect(page).toContain('Your email is confirmed.');
		expect(page).toContain('CONFIRM_LINK_INVALID_MESSAGE');
		expect(page).toContain('Resend it from Settings');
		expect(page).toContain('to="/settings"');
		expect(page).toContain('Try again');
		expect(page).toContain('refreshUser()');
		expect(page).toContain("pageTitle('Confirm email')");
	});

	it('shows the confirmation status in Settings and resends the email for unconfirmed email accounts', () => {
		const settings = source('/src/routes/settings/index.tsx');
		expect(settings).toContain('Resend confirmation email');
		expect(settings).toContain('apiClient.resendVerification()');
		expect(settings).toContain("user?.provider === 'email'");
		expect(settings).toContain('const emailSending = !!authProviders?.emailSending;');
	});

	it('shows the confirmation status and the resend button only when the server can send email', () => {
		const settings = source('/src/routes/settings/index.tsx');
		// Without email sending, "not confirmed" can't be fixed, so the status stays hidden.
		const gate = settings.indexOf('{emailSending && (');
		expect(gate).toBeGreaterThan(-1);
		expect(occurrences(settings, 'Email confirmed')).toBe(1);
		expect(occurrences(settings, 'Email not confirmed')).toBe(1);
		expect(settings.indexOf('Email confirmed')).toBeGreaterThan(gate);
		expect(settings.indexOf('Email not confirmed')).toBeGreaterThan(gate);
		expect(settings).toMatch(/const canResendConfirmation =\s*emailSending &&/);
		expect(settings.indexOf('{canResendConfirmation && (')).toBeLessThan(settings.indexOf('Resend confirmation email'));
	});

	it('renders the reset and confirm pages in the app theme, though they sit in the light public layout', () => {
		// .public-site forces a light color-scheme; app-theme-scope gives the Kumo components back the app theme.
		const card = source('/src/routes/auth/AccountEmailCard.tsx');
		expect(card.slice(card.indexOf('return ('))).toMatch(/^return \(\s*<section className="app-theme-scope /);
		for (const path of ['/src/routes/auth/ResetPasswordPage.tsx', '/src/routes/auth/VerifyEmailPage.tsx']) {
			const body = source(path).slice(source(path).indexOf('return ('));
			const open = body.indexOf('<AccountEmailCard');
			const close = body.indexOf('</AccountEmailCard>');
			expect(open).toBeGreaterThan(-1);
			expect(close).toBeGreaterThan(open);
			// Nothing but the page title renders outside the card.
			expect(body.slice(0, open) + body.slice(close)).not.toMatch(/<[A-Z]/);
		}
	});

	it('keeps the terms window off the pages opened from account emails', () => {
		const gate = source('/src/components/auth/TermsGate.tsx');
		expect(gate).toContain('LEGAL_LINKS');
		expect(gate).toContain('RESET_PASSWORD_PATH');
		expect(gate).toContain('VERIFY_EMAIL_PATH');
		expect(gate).toContain('GATE_FREE_PATHS.has(pathname)');
	});
});
