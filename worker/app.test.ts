import { describe, expect, it, vi } from 'vitest';
import type { Context, Next } from 'hono';

vi.mock('./api/routes', () => ({ setupRoutes: () => {} }));
vi.mock('./services/rate-limit/rateLimits', () => ({
	RateLimitService: { enforceGlobalApiRateLimit: async () => {} },
}));
vi.mock('./middleware/auth/routeAuth', () => ({
	AuthConfig: { ownerOnly: {} },
	setAuthLevel: () => async (_c: Context, next: Next) => next(),
}));

import { createApp } from './app';
import { CsrfService } from './services/csrf/CsrfService';

const env = {
	CUSTOM_DOMAIN: 'estori.app',
	ENVIRONMENT: 'prod',
	VibecoderStore: { get: async () => null },
	ASSETS: { fetch: async () => new Response('Not Found', { status: 404 }) },
} as unknown as Env;

function testApp() {
	const app = createApp(env);
	app.get('/api/ping', (c) => c.json({ ok: true }));
	app.post('/api/ping', (c) => c.json({ ok: true }));
	app.get('/api/needs-sign-in', (c) => c.json({ error: 'Sign in' }, 401));
	app.get('/api/redirect', () => Response.redirect('https://estori.app/', 302));
	// Like GET /api/auth/csrf-token: returns the token and sets its cookie itself.
	app.get('/api/token', () => {
		const response = Response.json({ token: 'issued' });
		CsrfService.setTokenCookie(response, 'issued');
		return response;
	});
	app.get('/auth/callback', (c) => c.text('ok'));
	return app;
}

function get(path: string, cookie?: string): Promise<Response> {
	const headers = cookie ? { Cookie: cookie } : undefined;
	return Promise.resolve(testApp().fetch(new Request(`https://estori.app${path}`, { headers }), env));
}

function csrfCookies(response: Response): string[] {
	return response.headers.getAll('Set-Cookie').filter((cookie) => cookie.startsWith(`${CsrfService.COOKIE_NAME}=`));
}

function tokenIn(setCookie: string): string {
	const value = setCookie.split(';')[0].slice(CsrfService.COOKIE_NAME.length + 1);
	const data: { token: string } = JSON.parse(decodeURIComponent(value));
	return data.token;
}

function cookieFor(token: string): string {
	return `${CsrfService.COOKIE_NAME}=${encodeURIComponent(JSON.stringify({ token, timestamp: Date.now() }))}`;
}

describe('CSRF cookie on API reads', () => {
	it('is set on a successful API read that arrives without one', async () => {
		const response = await get('/api/ping');

		expect(response.status).toBe(200);
		const cookies = csrfCookies(response);
		expect(cookies).toHaveLength(1);
		expect(cookies[0]).toContain('HttpOnly');
		expect(cookies[0]).toContain('SameSite=Strict');
	});

	it('carries a token that a later write can submit back', async () => {
		const [cookie] = csrfCookies(await get('/api/ping'));
		const token = tokenIn(cookie);

		const write = (headers: Record<string, string>) =>
			testApp().fetch(new Request('https://estori.app/api/ping', { method: 'POST', headers }), env);

		expect((await write({ Cookie: cookieFor(token), [CsrfService.HEADER_NAME]: token })).status).toBe(200);
		expect((await write({ Cookie: cookieFor(token) })).status).toBe(403);
	});

	it('keeps the valid cookie the browser already has', async () => {
		const response = await get('/api/ping', cookieFor('existing'));

		expect(response.status).toBe(200);
		expect(csrfCookies(response)).toHaveLength(0);
	});

	it('leaves the token endpoint its own cookie, so the cookie matches the token it returns', async () => {
		const response = await get('/api/token');

		const cookies = csrfCookies(response);
		expect(cookies).toHaveLength(1);
		expect(tokenIn(cookies[0])).toBe('issued');
	});

	it('is set on an API redirect, as OAuth callbacks return', async () => {
		const response = await get('/api/redirect');

		expect(response.status).toBe(302);
		expect(csrfCookies(response)).toHaveLength(1);
	});

	it('is not set on an API error', async () => {
		const response = await get('/api/needs-sign-in');

		expect(response.status).toBe(401);
		expect(csrfCookies(response)).toHaveLength(0);
	});

	it('is not set outside /api', async () => {
		const response = await get('/auth/callback');

		expect(response.status).toBe(200);
		expect(csrfCookies(response)).toHaveLength(0);
	});
});
