import { describe, expect, it } from 'vitest';
import { appBaseUrl, resetPasswordLink, verifyEmailLink } from './links';

function envWith(customDomain: string): Env {
	return { CUSTOM_DOMAIN: customDomain } as Env;
}

describe('appBaseUrl', () => {
	it('uses the custom domain in production, ignoring the request host', () => {
		const request = new Request('https://evil.example/x', { headers: { Host: 'evil.example' } });
		expect(appBaseUrl(envWith('estori.app'), request)).toBe('https://estori.app');
	});

	it('uses the request origin when no custom domain is set', () => {
		const request = new Request('http://localhost:8100/api/x');
		expect(appBaseUrl(envWith(''), request)).toBe('http://localhost:8100');
	});

	it('uses the request origin for a loopback request even with a custom domain', () => {
		const request = new Request('http://localhost:8100/api/x');
		expect(appBaseUrl(envWith('estori.app'), request)).toBe('http://localhost:8100');
	});

	it('treats 127.0.0.1 as a loopback', () => {
		const request = new Request('http://127.0.0.1:5173/api/x');
		expect(appBaseUrl(envWith('estori.app'), request)).toBe('http://127.0.0.1:5173');
	});

	it('treats a whitespace-only custom domain as unset', () => {
		const request = new Request('http://localhost:8100/api/x');
		expect(appBaseUrl(envWith('  '), request)).toBe('http://localhost:8100');
	});

	it('has no trailing slash', () => {
		expect(appBaseUrl(envWith('estori.app'), new Request('https://estori.app/'))).not.toMatch(/\/$/);
	});
});

describe('link builders', () => {
	it('builds the reset link with an encoded token', () => {
		expect(resetPasswordLink('https://estori.app', 'a b+c/d=')).toBe(
			'https://estori.app/reset-password?token=a%20b%2Bc%2Fd%3D',
		);
	});

	it('builds the confirmation link with an encoded token', () => {
		expect(verifyEmailLink('https://estori.app', 'a&b')).toBe('https://estori.app/verify-email?token=a%26b');
	});

	it('leaves a base64url token unchanged', () => {
		expect(verifyEmailLink('http://localhost:8100', 'Ab-_09')).toBe(
			'http://localhost:8100/verify-email?token=Ab-_09',
		);
	});
});
