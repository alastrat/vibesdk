import { afterEach, describe, expect, it } from 'vitest';
import { applyAccountLocale } from '@/lib/i18n';
import { oauthStartPath } from './oauth-start';

const sources = import.meta.glob<string>(['/src/lib/api-client.ts', '/src/contexts/auth-context.tsx'], { query: '?raw', import: 'default', eager: true });

afterEach(async () => {
	await applyAccountLocale('en');
});

describe('the address that starts a provider sign-in', () => {
	it('carries the language the visitor picked, so a new account starts in it', async () => {
		expect(oauthStartPath('google')).toBe('/api/auth/oauth/google?locale=en');
		await applyAccountLocale('es');
		expect(oauthStartPath('github')).toBe('/api/auth/oauth/github?locale=es');
		await applyAccountLocale('pt-BR');
		expect(oauthStartPath('cloudflare')).toBe('/api/auth/oauth/cloudflare?locale=pt-BR');
	});

	it('keeps the page to return to, encoded', async () => {
		await applyAccountLocale('es');
		const path = oauthStartPath('google', '/app/abc?action=star&x=1');
		expect(path).toBe('/api/auth/oauth/google?redirect_url=%2Fapp%2Fabc%3Faction%3Dstar%26x%3D1&locale=es');
		const params = new URL(path, 'https://estori.app').searchParams;
		expect(params.get('redirect_url')).toBe('/app/abc?action=star&x=1');
		expect(params.get('locale')).toBe('es');
	});

	it('leaves out a page to return to when there is none', () => {
		expect(new URL(oauthStartPath('google', ''), 'https://estori.app').searchParams.has('redirect_url')).toBe(false);
	});
});

describe('both places that leave for a provider', () => {
	it('build the address with the one builder, so they cannot disagree about the language', () => {
		const client = sources['/src/lib/api-client.ts'];
		const auth = sources['/src/contexts/auth-context.tsx'];
		expect(client).toContain('oauthStartPath(provider, redirectUrl)');
		expect(auth).toContain('oauthStartPath(provider, intendedUrl)');
		for (const text of [client, auth]) {
			expect(text).not.toContain('/api/auth/oauth/${provider}');
			expect(text).not.toContain("searchParams.set('redirect_url'");
		}
	});

	it('leave the provider-link start alone: it links an account that has a language already', () => {
		expect(sources['/src/lib/api-client.ts']).toMatch(/initiateProviderLink\(provider: OAuthProvider\): void \{[^}]*\/api\/auth\/link\/\$\{provider\}/s);
	});
});
