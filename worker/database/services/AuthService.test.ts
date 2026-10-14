import { describe, it, expect } from 'vitest';
import { providerLabel, signUpTermsError } from './AuthService';
import { TERMS_OUTDATED_MESSAGE, TERMS_REQUIRED_MESSAGE, TERMS_VERSION } from '../../../shared/types/legal';

describe('providerLabel', () => {
	it('maps known OAuth providers to display names', () => {
		expect(providerLabel('google')).toBe('Google');
		expect(providerLabel('github')).toBe('GitHub');
		expect(providerLabel('cloudflare')).toBe('Cloudflare');
	});

	it('falls back for email or unknown/missing providers', () => {
		expect(providerLabel('email')).toBe('a different sign-in method');
		expect(providerLabel('unknown')).toBe('a different sign-in method');
		expect(providerLabel(null)).toBe('a different sign-in method');
		expect(providerLabel(undefined)).toBe('a different sign-in method');
	});
});

describe('signUpTermsError', () => {
	it('accepts the current terms version', () => {
		expect(signUpTermsError(TERMS_VERSION)).toBeNull();
	});

	it('asks for agreement when no version was sent', () => {
		expect(signUpTermsError(undefined)).toBe(TERMS_REQUIRED_MESSAGE);
		expect(signUpTermsError('')).toBe(TERMS_REQUIRED_MESSAGE);
		expect(signUpTermsError(20261013)).toBe(TERMS_REQUIRED_MESSAGE);
	});

	it('asks for a reload when the page agreed to an older version', () => {
		expect(signUpTermsError('2020-01-01')).toBe(TERMS_OUTDATED_MESSAGE);
	});
});
