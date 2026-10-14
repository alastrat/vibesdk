import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { RouteContext } from '../../types/route-context';
import type { AuthUser } from '../../../types/auth-types';
import { DEFAULT_RATE_LIMIT_SETTINGS, RateLimitType } from '../../../services/rate-limit/config';
import { CONFIRM_LINK_INVALID_MESSAGE } from '../../../services/auth/one-time-token';
import { TERMS_VERSION } from '../../../../shared/types/legal';

const { mockVerifyEmail, mockResendEmailConfirmation, mockRegister } = vi.hoisted(() => ({
	mockVerifyEmail: vi.fn(),
	mockResendEmailConfirmation: vi.fn(),
	mockRegister: vi.fn(),
}));

vi.mock('../../../database/services/AuthService', () => ({
	AuthService: vi.fn().mockImplementation(() => ({
		verifyEmail: mockVerifyEmail,
		resendEmailConfirmation: mockResendEmailConfirmation,
		register: mockRegister,
	})),
}));

import { AuthController } from './controller';
import { RateLimitService } from '../../../services/rate-limit/rateLimits';
import { RateLimitExceededError, SecurityError, SecurityErrorType } from 'shared/types/errors';

const sources = import.meta.glob<string>(['/worker/api/routes/authRoutes.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function routeLine(path: string): string {
	const text = sources['/worker/api/routes/authRoutes.ts'];
	if (text === undefined) throw new Error('Source not found: authRoutes.ts');
	const line = text.split('\n').find((candidate) => candidate.includes(`'${path}'`));
	if (!line) throw new Error(`Route not found: ${path}`);
	return line;
}

const sendEmail = vi.fn();
const ENV = { CUSTOM_DOMAIN: 'estori.app', ENVIRONMENT: 'prod', EMAIL: { send: sendEmail } } as unknown as Env;
const USER = { id: 'user-1', email: 'user@example.test', emailVerified: false, provider: 'email' } as AuthUser;

function context(user: AuthUser | null = null): RouteContext {
	return {
		user,
		sessionId: user ? 'session-1' : null,
		config: { security: { rateLimit: DEFAULT_RATE_LIMIT_SETTINGS } },
		pathParams: {},
		queryParams: new URLSearchParams(),
	} as unknown as RouteContext;
}

function post(path: string, body?: unknown): Request {
	return new Request(`https://estori.app/api/auth/${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body ?? {}),
	});
}

function verify(body: unknown): Promise<Response> {
	return AuthController.verifyEmail(post('verify-email', body), ENV, {} as ExecutionContext, context());
}

function resend(user: AuthUser | null = USER): Promise<Response> {
	return AuthController.resendVerification(post('resend-verification'), ENV, {} as ExecutionContext, context(user));
}

async function message(response: Response): Promise<string | undefined> {
	const json = (await response.json()) as { data?: { message: string }; error?: { message: string } };
	return json.data?.message ?? json.error?.message;
}

let enforceClient: MockInstance<typeof RateLimitService.enforceAuthEmailRateLimit>;
let enforceResend: MockInstance<typeof RateLimitService.enforceEmailConfirmationResendRateLimit>;

beforeEach(() => {
	mockVerifyEmail.mockReset().mockResolvedValue(undefined);
	mockResendEmailConfirmation.mockReset().mockResolvedValue(undefined);
	mockRegister.mockReset();
	enforceClient = vi.spyOn(RateLimitService, 'enforceAuthEmailRateLimit').mockResolvedValue(undefined);
	enforceResend = vi.spyOn(RateLimitService, 'enforceEmailConfirmationResendRateLimit').mockResolvedValue(undefined);
});

afterEach(() => {
	enforceClient.mockRestore();
	enforceResend.mockRestore();
});

describe('AuthController.verifyEmail', () => {
	it('answers 200 once the service has confirmed the address', async () => {
		const response = await verify({ token: 'raw-token' });
		expect(response.status).toBe(200);
		expect(await message(response)).toBe('Your email is confirmed.');
		expect(mockVerifyEmail).toHaveBeenCalledWith('raw-token');
	});

	it('answers 400 with the invalid-link message for a bad link', async () => {
		mockVerifyEmail.mockRejectedValue(new SecurityError(SecurityErrorType.INVALID_TOKEN, CONFIRM_LINK_INVALID_MESSAGE, 400));
		const response = await verify({ token: 'raw-token' });
		expect(response.status).toBe(400);
		expect(await message(response)).toBe(CONFIRM_LINK_INVALID_MESSAGE);
	});

	it.each([
		['no token', {}],
		['an empty token', { token: '' }],
		['an oversized token', { token: 'x'.repeat(201) }],
	])('answers 400 with the invalid-link message for %s, without calling the service', async (_label, body) => {
		const response = await verify(body);
		expect(response.status).toBe(400);
		expect(await message(response)).toBe(CONFIRM_LINK_INVALID_MESSAGE);
		expect(mockVerifyEmail).not.toHaveBeenCalled();
	});
});

describe('AuthController.resendVerification', () => {
	it('answers 200 and asks the service to email the signed-in user through the configured domain', async () => {
		const response = await resend();
		expect(response.status).toBe(200);
		expect(await message(response)).toBe('If your email is not confirmed yet, we sent a new link.');
		expect(mockResendEmailConfirmation).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({ send: expect.any(Function) }),
			'https://estori.app',
		);
	});

	it('counts the resend limit against the signed-in user in its own bucket', async () => {
		await resend();
		expect(enforceResend).toHaveBeenCalledWith(ENV, DEFAULT_RATE_LIMIT_SETTINGS, 'user-1');
		expect(enforceClient).not.toHaveBeenCalled();
	});

	it('answers 429 without sending when the user has asked too often', async () => {
		enforceResend.mockRejectedValue(
			new RateLimitExceededError('Confirmation email limit reached', RateLimitType.EMAIL_CONFIRMATION_RESEND, 3, 3600, [
				'Please try again in an hour.',
			]),
		);
		const response = await resend();
		expect(response.status).toBe(429);
		expect(mockResendEmailConfirmation).not.toHaveBeenCalled();
	});

	it('answers 401 without a signed-in user', async () => {
		const response = await resend(null);
		expect(response.status).toBe(401);
		expect(mockResendEmailConfirmation).not.toHaveBeenCalled();
		expect(enforceResend).not.toHaveBeenCalled();
	});
});

describe('AuthController.register', () => {
	it('gives the service the email sender and the configured domain for the confirmation link', async () => {
		mockRegister.mockResolvedValue({
			user: USER,
			sessionId: 'session-1',
			expiresAt: new Date(Date.now() + 60_000),
			accessToken: 'access-token',
		});
		const request = post('register', { email: 'user@example.test', password: 'A-new-Passw0rd-for-Estori', acceptedTermsVersion: TERMS_VERSION });
		const response = await AuthController.register(request, ENV, {} as ExecutionContext, context());

		expect(response.status).toBe(200);
		expect(mockRegister).toHaveBeenCalledWith(
			expect.objectContaining({ email: 'user@example.test' }),
			request,
			expect.objectContaining({ send: expect.any(Function) }),
			'https://estori.app',
		);
	});
});

describe('AuthController.getAuthProviders', () => {
	async function providers(env: Env): Promise<Record<string, boolean>> {
		const response = await AuthController.getAuthProviders(new Request('https://estori.app/api/auth/providers'), env, {} as ExecutionContext, context());
		const json = (await response.json()) as { data: { providers: Record<string, boolean> } };
		return json.data.providers;
	}

	it('reports email sending off in production without the email binding', async () => {
		expect((await providers({ ENVIRONMENT: 'prod' } as unknown as Env)).emailSending).toBe(false);
	});

	it('reports email sending on with the email binding', async () => {
		expect((await providers(ENV)).emailSending).toBe(true);
	});

	it('reports email sending on in local development, where emails go to the log', async () => {
		expect((await providers({ ENVIRONMENT: 'dev' } as unknown as Env)).emailSending).toBe(true);
	});
});

describe('email confirmation routes', () => {
	it('serves verify-email publicly, since the link is opened from an inbox', () => {
		const line = routeLine('/verify-email');
		expect(line).toContain('authRouter.post(');
		expect(line).toContain('setAuthLevel(AuthConfig.public)');
		expect(line).toContain('AuthController.verifyEmail');
	});

	it('serves resend-verification only to signed-in users', () => {
		const line = routeLine('/resend-verification');
		expect(line).toContain('authRouter.post(');
		expect(line).toContain('setAuthLevel(AuthConfig.authenticated)');
		expect(line).toContain('AuthController.resendVerification');
	});
});
