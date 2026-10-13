import { describe, expect, it } from 'vitest';
import {
	ADMIN_EMAIL_PROVIDER_MESSAGE,
	EMAIL_VERIFYING_PROVIDERS,
	PLATFORM_ADMIN_EMAILS,
	isPlatformAdminDecision,
	isPlatformAdminEmail,
	mayClaimEmailByOAuth,
} from './admin-access';

describe('isPlatformAdminDecision', () => {
	it('names the owner as the platform admin', () => {
		expect(PLATFORM_ADMIN_EMAILS).toEqual(['alastrat@pluriza.com']);
	});

	it('keeps every admin email lowercase so the lowercased comparison can match', () => {
		for (const email of PLATFORM_ADMIN_EMAILS) {
			expect(email).toBe(email.toLowerCase());
		}
	});

	it('trusts only Google and GitHub to verify an email', () => {
		expect(EMAIL_VERIFYING_PROVIDERS).toEqual(['google', 'github']);
	});

	it('grants admin from the role', () => {
		expect(isPlatformAdminDecision('admin', [])).toBe(true);
	});

	it('grants admin from a provider-verified admin email, in any case', () => {
		expect(
			isPlatformAdminDecision('user', [{ provider: 'google', email: 'Alastrat@Pluriza.com', emailVerified: true }]),
		).toBe(true);
		expect(
			isPlatformAdminDecision('user', [{ provider: 'github', email: 'alastrat@pluriza.com', emailVerified: true }]),
		).toBe(true);
	});

	it('never grants admin from an unverified email', () => {
		expect(
			isPlatformAdminDecision('user', [{ provider: 'google', email: 'alastrat@pluriza.com', emailVerified: false }]),
		).toBe(false);
		expect(
			isPlatformAdminDecision('user', [{ provider: 'github', email: 'alastrat@pluriza.com', emailVerified: null }]),
		).toBe(false);
	});

	it('never grants admin from a Cloudflare identity, which defaults to verified', () => {
		expect(
			isPlatformAdminDecision('user', [{ provider: 'cloudflare', email: 'alastrat@pluriza.com', emailVerified: true }]),
		).toBe(false);
	});

	it('ignores other verified emails', () => {
		expect(
			isPlatformAdminDecision('user', [{ provider: 'google', email: 'someone@pluriza.com', emailVerified: true }]),
		).toBe(false);
		expect(isPlatformAdminDecision(null, [{ provider: 'github', email: null, emailVerified: true }])).toBe(false);
	});
});

describe('isPlatformAdminEmail', () => {
	it('matches the admin email regardless of case and surrounding spaces', () => {
		expect(isPlatformAdminEmail('alastrat@pluriza.com')).toBe(true);
		expect(isPlatformAdminEmail('  Alastrat@Pluriza.COM ')).toBe(true);
	});

	it('does not match other addresses', () => {
		expect(isPlatformAdminEmail('someone@pluriza.com')).toBe(false);
		expect(isPlatformAdminEmail('alastrat@pluriza.com.evil.test')).toBe(false);
		expect(isPlatformAdminEmail('')).toBe(false);
	});
});

describe('mayClaimEmailByOAuth', () => {
	it('lets Google and GitHub claim the admin email, because they verify it', () => {
		expect(mayClaimEmailByOAuth('google', 'alastrat@pluriza.com')).toBe(true);
		expect(mayClaimEmailByOAuth('github', 'Alastrat@Pluriza.com')).toBe(true);
	});

	it('keeps Cloudflare from claiming the admin email, in any case', () => {
		expect(mayClaimEmailByOAuth('cloudflare', 'alastrat@pluriza.com')).toBe(false);
		expect(mayClaimEmailByOAuth('cloudflare', ' ALASTRAT@pluriza.com ')).toBe(false);
	});

	it('lets every provider claim any other email', () => {
		for (const provider of ['google', 'github', 'cloudflare']) {
			expect(mayClaimEmailByOAuth(provider, 'someone@pluriza.com')).toBe(true);
		}
	});

	it('tells the user which providers can claim the email', () => {
		expect(ADMIN_EMAIL_PROVIDER_MESSAGE).toBe('Sign in with Google or GitHub to use this email');
	});
});
