import { describe, expect, it } from 'vitest';
import { filterSkippedSecrets } from './deploy-secrets';

const NAMES = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'JWT_SECRET', 'ENABLE_ARTIFACTS'];

describe('filterSkippedSecrets', () => {
	it('keeps every name when nothing is skipped', () => {
		expect(filterSkippedSecrets(NAMES, undefined)).toEqual(NAMES);
		expect(filterSkippedSecrets(NAMES, '')).toEqual(NAMES);
	});

	it('drops the listed names', () => {
		expect(filterSkippedSecrets(NAMES, 'CLOUDFLARE_API_TOKEN')).toEqual([
			'CLOUDFLARE_ACCOUNT_ID',
			'JWT_SECRET',
			'ENABLE_ARTIFACTS',
		]);
	});

	it('trims entries and ignores empty and unknown ones', () => {
		expect(filterSkippedSecrets(NAMES, ' CLOUDFLARE_API_TOKEN , ,NOT_A_SECRET ')).toEqual([
			'CLOUDFLARE_ACCOUNT_ID',
			'JWT_SECRET',
			'ENABLE_ARTIFACTS',
		]);
	});

	it('keeps JWT_SECRET unless it is explicitly skipped', () => {
		expect(filterSkippedSecrets(NAMES, 'CLOUDFLARE_API_TOKEN')).toContain('JWT_SECRET');
	});
});
