/** Starting a provider sign-in stores the language picked on the sign-in page, and only a language we speak. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { envWith, insertUser, migratedD1 } from '../../../database/test-support/real-d1';
import { AuthService } from '../../../database/services/AuthService';
import type { BaseOAuthProvider } from '../../../services/oauth/base';
import { AuthController } from './controller';
import type { RouteContext } from '../../types/route-context';

let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'linker');
	const fake = { redirectUri: 'https://estori.app/api/auth/callback/google', getAuthorizationUrl: async (state: string) => `https://accounts.example.test/auth?state=${state}` } as unknown as BaseOAuthProvider;
	vi.spyOn(AuthService.prototype, 'getOauthProvider').mockResolvedValue(fake);
});

afterEach(() => {
	vi.clearAllMocks();
});

const env = () => envWith(db, { JWT_SECRET: 'test-only-jwt-secret-of-at-least-32-characters', ENVIRONMENT: 'dev' });

/** Starts a Google sign-in with `query`, and answers what the state row it made holds. */
async function start(query: Record<string, string>): Promise<{ status: number; locale: string | null }> {
	const url = new URL('https://estori.app/api/auth/oauth/google');
	for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
	const response = await AuthController.initiateOAuth(new Request(url), env(), {} as ExecutionContext, {
		pathParams: { provider: 'google' },
		queryParams: url.searchParams,
	} as unknown as RouteContext);
	const state = new URL(response.headers.get('Location') ?? 'https://invalid.test').searchParams.get('state');
	const row = await db.prepare('SELECT locale FROM oauth_states WHERE state = ?').bind(state).first<{ locale: string | null }>();
	return { status: response.status, locale: row === null ? null : row.locale };
}

describe('GET /api/auth/oauth/:provider', () => {
	it.each(['en', 'es', 'pt-BR'])('stores the picked language: %s', async (locale) => {
		expect(await start({ locale })).toEqual({ status: 302, locale });
	});

	it.each([
		['one we do not speak', 'fr'],
		['the wrong case', 'pt-br'],
		['a language without its region', 'pt'],
		['an empty value', ''],
		['markup', '<script>'],
	])('stores nothing for %s, and still sends the visitor to the provider', async (_label, locale) => {
		expect(await start({ locale })).toEqual({ status: 302, locale: null });
	});

	it('stores nothing when no language was sent', async () => {
		expect(await start({})).toEqual({ status: 302, locale: null });
	});

	it('keeps the language next to the page to return to', async () => {
		const result = await start({ locale: 'es', redirect_url: '/settings' });
		expect(result).toEqual({ status: 302, locale: 'es' });
		const row = await db.prepare(`SELECT redirect_uri FROM oauth_states WHERE locale = 'es' ORDER BY created_at DESC LIMIT 1`).first<{ redirect_uri: string }>();
		expect(row?.redirect_uri).toBe('/settings');
	});
});

describe('GET /api/auth/link/:provider', () => {
	it('links a provider to the signed-in account and stores no language', async () => {
		const url = new URL('https://estori.app/api/auth/link/google?locale=es');
		const response = await AuthController.initiateProviderLink(new Request(url), env(), {} as ExecutionContext, {
			user: { id: 'linker', email: 'linker@example.test' },
			pathParams: { provider: 'google' },
			queryParams: url.searchParams,
		} as unknown as RouteContext);
		const state = new URL(response.headers.get('Location') ?? 'https://invalid.test').searchParams.get('state');
		const row = await db.prepare('SELECT user_id, locale FROM oauth_states WHERE state = ?').bind(state).first<{ user_id: string; locale: string | null }>();
		expect(response.status).toBe(302);
		expect(row).toEqual({ user_id: 'linker', locale: null });
	});
});
