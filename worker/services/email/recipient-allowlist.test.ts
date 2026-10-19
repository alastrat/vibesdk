import { describe, expect, it } from 'vitest';
import { recipientAllowlist } from './recipient-allowlist';

describe('the email recipient allowlist', () => {
	it('allows everyone when unset or empty, as in production', () => {
		expect(recipientAllowlist(undefined)).toBeNull();
		expect(recipientAllowlist('  ')).toBeNull();
	});

	it('allows listed addresses and anyone at a listed domain, ignoring case and spaces', () => {
		const allows = recipientAllowlist(' @Pluriza.com , ana@example.com ');
		expect(allows?.('alastrat@pluriza.com')).toBe(true);
		expect(allows?.('Someone@PLURIZA.COM')).toBe(true);
		expect(allows?.('ANA@example.com')).toBe(true);
		expect(allows?.('bob@example.com')).toBe(false);
		expect(allows?.('eve@notpluriza.com')).toBe(false);
		expect(allows?.('eve@pluriza.com.evil.test')).toBe(false);
	});
});
