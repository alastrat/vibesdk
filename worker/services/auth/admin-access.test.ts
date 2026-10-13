import { describe, expect, it } from 'vitest';
import { PLATFORM_ADMIN_EMAILS, isPlatformAdminDecision } from './admin-access';

describe('isPlatformAdminDecision', () => {
	it('names the owner as the platform admin', () => {
		expect(PLATFORM_ADMIN_EMAILS).toEqual(['alastrat@pluriza.com']);
	});

	it('grants admin from the role', () => {
		expect(isPlatformAdminDecision('admin', [])).toBe(true);
	});

	it('grants admin from a provider-verified admin email, in any case', () => {
		expect(isPlatformAdminDecision('user', [{ email: 'Alastrat@Pluriza.com', emailVerified: true }])).toBe(true);
	});

	it('never grants admin from an unverified email', () => {
		expect(isPlatformAdminDecision('user', [{ email: 'alastrat@pluriza.com', emailVerified: false }])).toBe(false);
		expect(isPlatformAdminDecision('user', [{ email: 'alastrat@pluriza.com', emailVerified: null }])).toBe(false);
	});

	it('ignores other verified emails', () => {
		expect(isPlatformAdminDecision('user', [{ email: 'someone@pluriza.com', emailVerified: true }])).toBe(false);
		expect(isPlatformAdminDecision(null, [{ email: null, emailVerified: true }])).toBe(false);
	});
});
