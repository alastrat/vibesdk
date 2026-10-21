/** A provider sign-up saves the language the browser asked for on the new account, and never touches an existing one. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { envWith, insertUser, migratedD1 } from '../test-support/real-d1';
import type { BaseOAuthProvider } from '../../services/oauth/base';
import type { OAuthProvider, OAuthUserInfo } from '../../types/auth-types';
import { AuthService } from './AuthService';

const JWT_SECRET = 'test-only-jwt-secret-of-at-least-32-characters';
const NONCE = 'nonce-1';

let db: D1Database;
let states = 0;

beforeAll(async () => {
	db = await migratedD1();
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** Signs in through `provider` as `info`, sending `acceptLanguage` (or none). */
async function signIn(provider: OAuthProvider, info: OAuthUserInfo, acceptLanguage?: string) {
	const state = `state-${++states}`;
	await db
		.prepare(`INSERT INTO oauth_states (id, state, provider, scopes, code_verifier, nonce, created_at, expires_at, is_used) VALUES (?, ?, ?, '[]', 'verifier', ?, ?, ?, 0)`)
		.bind(`state-row-${states}`, state, provider, NONCE, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000) + 300)
		.run();
	const fake = { exchangeCodeForTokens: async () => ({ accessToken: 'token', tokenType: 'Bearer' }), getUserInfo: async () => info } as unknown as BaseOAuthProvider;
	vi.spyOn(AuthService.prototype, 'getOauthProvider').mockResolvedValue(fake);
	const headers: Record<string, string> = { Cookie: `oauth_nonce=${NONCE}`, 'CF-Connecting-IP': '203.0.113.9' };
	if (acceptLanguage !== undefined) headers['Accept-Language'] = acceptLanguage;
	const request = new Request(`http://localhost/api/auth/callback/${provider}?code=code-1&state=${state}`, { headers });
	return new AuthService(envWith(db, { JWT_SECRET, ENVIRONMENT: 'dev' })).handleOAuthCallback(provider, 'code-1', state, request);
}

const person = (id: string, email: string): OAuthUserInfo => ({ id, email, name: id, emailVerified: true });

const storedPreferences = async (email: string): Promise<unknown> => {
	const row = await db.prepare('SELECT preferences FROM users WHERE email = ?').bind(email).first<{ preferences: string | null }>();
	return row?.preferences === null || row === null ? null : JSON.parse(row.preferences);
};

describe('a new account made through a provider', () => {
	it.each([
		['Portuguese, as Brazilian', 'pt-PT,pt;q=0.9,en;q=0.5', 'pt-BR'],
		['Spanish', 'es-MX,es;q=0.9', 'es'],
		['the first language we speak', 'fr-FR,fr;q=0.9,pt;q=0.8', 'pt-BR'],
		['a language we do not speak', 'fr-FR,de;q=0.8', 'en'],
	])('starts in the language of the browser: %s', async (_label, header, expected) => {
		const email = `new-${expected}-${states}@example.test`.toLowerCase();
		const result = await signIn('google', person(`g-${expected}-${states}`, email), header);
		expect(result.isNewUser).toBe(true);
		expect(result.user.locale).toBe(expected);
		expect(await storedPreferences(email)).toEqual({ locale: expected });
	});

	it('starts in English when the browser sent no languages', async () => {
		const result = await signIn('github', person('gh-none', 'new-none@example.test'));
		expect(result.isNewUser).toBe(true);
		expect(await storedPreferences('new-none@example.test')).toEqual({ locale: 'en' });
	});

	it('keeps that language when the person signs in again from a browser in another language', async () => {
		await signIn('google', person('g-again', 'again@example.test'), 'es-MX');
		const again = await signIn('google', person('g-again', 'again@example.test'), 'pt-BR');
		expect(again.isNewUser).toBe(false);
		expect(again.user.locale).toBe('es');
		expect(await storedPreferences('again@example.test')).toEqual({ locale: 'es' });
	});
});

describe('an account that already exists', () => {
	it('keeps the language it saved when a provider links to it', async () => {
		await insertUser(db, 'saved_1', { emailVerified: true });
		await db.prepare(`UPDATE users SET preferences = '{"theme":"dark","locale":"es"}' WHERE id = 'saved_1'`).run();
		const result = await signIn('google', person('g-saved', 'saved_1@example.test'), 'pt-BR');
		expect(result.isNewUser).toBe(false);
		expect(result.user.id).toBe('saved_1');
		expect(result.user.locale).toBe('es');
		expect(await storedPreferences('saved_1@example.test')).toEqual({ theme: 'dark', locale: 'es' });
	});

	it('is not given a language when it never chose one: signing in is not a choice', async () => {
		await insertUser(db, 'none_1', { emailVerified: true });
		const before = await storedPreferences('none_1@example.test');
		const result = await signIn('github', person('gh-none-1', 'none_1@example.test'), 'pt-BR');
		expect(result.isNewUser).toBe(false);
		expect(result.user.locale).toBeNull();
		expect(await storedPreferences('none_1@example.test')).toEqual(before);
		expect(before).not.toHaveProperty('locale');
	});

	it('is not given one when a provider claims it before its email was confirmed', async () => {
		await insertUser(db, 'claim_1', { emailVerified: false });
		const before = await storedPreferences('claim_1@example.test');
		const result = await signIn('google', person('g-claim', 'claim_1@example.test'), 'es-MX');
		expect(result.isNewUser).toBe(false);
		expect(result.user.id).toBe('claim_1');
		expect(await storedPreferences('claim_1@example.test')).toEqual(before);
	});
});
