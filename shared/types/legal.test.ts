import { describe, expect, it } from 'vitest';
import { TERMS_VERSION, isCurrentTermsVersion, legalAddressLine } from './legal';

describe('terms version', () => {
	it('accepts only the current version', () => {
		expect(isCurrentTermsVersion(TERMS_VERSION)).toBe(true);
		expect(isCurrentTermsVersion('2020-01-01')).toBe(false);
		expect(isCurrentTermsVersion(undefined)).toBe(false);
		expect(isCurrentTermsVersion(20261013)).toBe(false);
	});

	it('formats the address on one line', () => {
		expect(legalAddressLine()).toBe('206 Gray Street, Unit 3112, Houston, TX 77002');
	});
});
