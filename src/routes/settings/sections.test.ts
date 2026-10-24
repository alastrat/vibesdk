import { describe, expect, it } from 'vitest';
import { accountSection, accountSectionSearch } from './sections';

describe('account settings destinations', () => {
	it('opens gateway configuration from the existing configuration prompt', () => {
		expect(accountSection('?config_needed=true', '')).toBe('connections');
		expect(accountSection('?config_needed=true&section=security', '')).toBe('security');
	});
	it('preserves old links to API keys, language, privacy, and account confirmation', () => {
		for (const [hash, section] of [
			['#api-keys', 'security'],
			['#security', 'security'],
			['#language', 'appearance'],
			['#analytics', 'privacy'],
			['#danger-zone', 'privacy'],
			['#account', 'profile'],
		]) {
			expect(accountSection('?section=profile', hash)).toBe(section);
		}
	});
	it('restores a selected section after reload and ignores unknown destinations', () => {
		expect(accountSection('?section=connections', '')).toBe('connections');
		expect(accountSection('?section=unknown', '#unknown')).toBe('profile');
	});
	it('retains return parameters when selecting a section', () => {
		const next = accountSectionSearch(
			'?cloudflare=connected&section=profile',
			'connections',
		);
		expect(new URLSearchParams(next).get('cloudflare')).toBe('connected');
		expect(accountSection(next, '')).toBe('connections');
	});
});
