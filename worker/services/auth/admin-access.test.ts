import { describe, expect, it } from 'vitest';
import {
	EMAIL_VERIFYING_PROVIDERS,
	PLATFORM_ADMIN_EMAILS,
	isPlatformAdminDecision,
	isPlatformAdminEmail,
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
