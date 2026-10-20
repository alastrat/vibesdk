import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TERMS_VERSION } from '../../../../shared/types/legal';
import type { RouteContext } from '../../types/route-context';

const recorded = vi.hoisted(() => ({ calls: [] as string[], events: [] as Array<{ name: string; userId: string; properties: unknown }> }));
const auth = vi.hoisted(() => ({ register: vi.fn(), login: vi.fn(), verifyEmail: vi.fn(), handleOAuthCallback: vi.fn(), getPendingLinkUserId: vi.fn(async () => null) }));

vi.mock('../../../database/services/AuthService', () => ({ AuthService: vi.fn().mockImplementation(() => auth) }));
vi.mock('../../../services/posthog/session', () => ({
	sessionTelemetry: async () => {
		recorded.calls.push('telemetry');
		return { flags: { billing: false, 'store-drafts-paused': false, 'catalog-paused': false, 'session-replay-paused': false }, analyticsOptOut: false };
	},
	honorAnalyticsChoice: async () => {
		recorded.calls.push('gpc');
		return false;
	},
}));
vi.mock('../../../services/posthog/person', () => ({ personUpdateOf: async () => ({ set: { plan: 'basic' } }) }));
vi.mock('../../../services/posthog/analytics', () => ({
	serverAnalytics: () => ({
		capture: (name: string, userId: string, properties: unknown) => {
			recorded.calls.push(`capture:${name}`);
			recorded.events.push({ name, userId, properties });
		},
	}),
}));

const { AuthController } = await import('./controller');

const env = { ENVIRONMENT: 'dev', JWT_SECRET: 'Test-Secret-1234567890-abcdefghijklmnop-!@#$' } as unknown as Env;
const SESSION = { user: { id: 'user-1', email: 'ana@example.test' }, sessionId: 's1', expiresAt: null, accessToken: 'token' };
const post = (path: string, body: unknown) =>
	new Request(`https://estori.app${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
	recorded.calls.length = 0;
	recorded.events.length = 0;
});

describe('account events', () => {
	it('sends account_created on a password sign-up, after GPC is honored, without the email', async () => {
		auth.register.mockResolvedValue(SESSION);
		await AuthController.register(post('/api/auth/register', { email: 'ana@example.test', password: 'A-strong-pass-123!', acceptedTermsVersion: TERMS_VERSION }), env, {} as ExecutionContext, {} as RouteContext);
		expect(recorded.calls).toEqual(['telemetry', 'capture:account_created']);
		expect(recorded.events).toEqual([{ name: 'account_created', userId: 'user-1', properties: { method: 'password' } }]);
		expect(JSON.stringify(recorded.events)).not.toContain('ana@example.test');
	});

	it('sends signed_in on a password sign-in', async () => {
		auth.login.mockResolvedValue(SESSION);
		await AuthController.login(post('/api/auth/login', { email: 'ana@example.test', password: 'whatever' }), env, {} as ExecutionContext, {} as RouteContext);
		expect(recorded.events).toEqual([{ name: 'signed_in', userId: 'user-1', properties: { method: 'password' } }]);
	});

	it('sends email_confirmed for the confirmed user, after GPC is honored', async () => {
		auth.verifyEmail.mockResolvedValue('user-1');
		await AuthController.verifyEmail(post('/api/auth/verify-email', { token: 'raw-token' }), env, {} as ExecutionContext, {} as RouteContext);
		expect(recorded.calls).toEqual(['gpc', 'capture:email_confirmed']);
	});

	it('sends account_created for a new provider account and signed_in for a returning one', async () => {
		auth.handleOAuthCallback.mockResolvedValueOnce({ ...SESSION, isNewUser: true }).mockResolvedValueOnce({ ...SESSION, isNewUser: false });
		const callback = new Request('https://estori.app/api/auth/callback/google?code=c&state=s');
		const context = { pathParams: { provider: 'google' }, queryParams: new URL(callback.url).searchParams } as unknown as RouteContext;
		await AuthController.handleOAuthCallback(callback, env, {} as ExecutionContext, context);
		await AuthController.handleOAuthCallback(callback, env, {} as ExecutionContext, context);
		expect(recorded.events.map((event) => [event.name, event.properties])).toEqual([
			['account_created', { method: 'google' }],
			['signed_in', { method: 'google' }],
		]);
		expect(recorded.calls.indexOf('gpc')).toBeLessThan(recorded.calls.indexOf('capture:account_created'));
	});
});
