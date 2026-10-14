import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { RouteContext } from '../../types/route-context';
import { DEFAULT_RATE_LIMIT_SETTINGS, RateLimitType } from '../../../services/rate-limit/config';
import { FORGOT_PASSWORD_MESSAGE, RESET_LINK_INVALID_MESSAGE } from '../../../services/auth/one-time-token';

const { mockRequestPasswordReset, mockResetPassword } = vi.hoisted(() => ({
	mockRequestPasswordReset: vi.fn(),
	mockResetPassword: vi.fn(),
}));

vi.mock('../../../database/services/AuthService', () => ({
	AuthService: vi.fn().mockImplementation(() => ({
		requestPasswordReset: mockRequestPasswordReset,
		resetPassword: mockResetPassword,
	})),
}));

import { AuthController } from './controller';
import { RateLimitService } from '../../../services/rate-limit/rateLimits';
import { RateLimitExceededError, SecurityError, SecurityErrorType } from 'shared/types/errors';

const sources = import.meta.glob<string>(['/worker/api/routes/authRoutes.ts', '/worker/api/controllers/auth/controller.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

function methodBody(text: string, signature: string): string {
	const start = text.indexOf(signature);
	if (start === -1) throw new Error(`Method not found: ${signature}`);
	const next = text.indexOf('\n    /**', start);
	return next === -1 ? text.slice(start) : text.slice(start, next);
}

const sendEmail = vi.fn();
const ENV = { CUSTOM_DOMAIN: 'estori.app', EMAIL: { send: sendEmail } } as unknown as Env;
const EMAIL_AUTH_OFF = { ...ENV, ENABLE_EMAIL_AUTH: 'false' } as unknown as Env;

function context(): RouteContext {
	return {
		user: null,
		sessionId: null,
		config: { security: { rateLimit: DEFAULT_RATE_LIMIT_SETTINGS } },
		pathParams: {},
		queryParams: new URLSearchParams(),
	} as unknown as RouteContext;
}

function post(path: string, body: unknown): Request {
	return new Request(`https://estori.app/api/auth/${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

function forgot(body: unknown, env: Env = ENV): Promise<Response> {
	return AuthController.forgotPassword(post('forgot-password', body), env, {} as ExecutionContext, context());
}

function reset(body: unknown, env: Env = ENV): Promise<Response> {
	return AuthController.resetPassword(post('reset-password', body), env, {} as ExecutionContext, context());
}

const STRONG_PASSWORD = 'A-new-Passw0rd-for-Estori';

function limitError(type: RateLimitType): RateLimitExceededError {
	return new RateLimitExceededError('Account email limit reached', type, 5, 3600, ['Please try again in an hour.']);
}

let enforceClient: MockInstance<typeof RateLimitService.enforceAuthEmailRateLimit>;
let enforceRecipient: MockInstance<typeof RateLimitService.enforceAuthEmailRecipientRateLimit>;

beforeEach(() => {
	mockRequestPasswordReset.mockReset().mockResolvedValue(undefined);
	mockResetPassword.mockReset().mockResolvedValue(undefined);
	enforceClient = vi.spyOn(RateLimitService, 'enforceAuthEmailRateLimit').mockResolvedValue(undefined);
	enforceRecipient = vi.spyOn(RateLimitService, 'enforceAuthEmailRecipientRateLimit').mockResolvedValue(undefined);
});

afterEach(() => {
	enforceClient.mockRestore();
	enforceRecipient.mockRestore();
});

describe('AuthController.forgotPassword', () => {
	it('answers 200 with the fixed message and asks the service to email the lowercased address', async () => {
		const response = await forgot({ email: 'User@Example.test' });
		expect(response.status).toBe(200);
		const json = (await response.json()) as { data: { message: string } };
		expect(json.data.message).toBe(FORGOT_PASSWORD_MESSAGE);
		expect(mockRequestPasswordReset).toHaveBeenCalledWith(
			'user@example.test',
			expect.objectContaining({ send: expect.any(Function) }),
			'https://estori.app',
		);
	});

	it('answers the same message when the service fails', async () => {
		mockRequestPasswordReset.mockRejectedValue(new Error('D1 is unavailable'));
		const response = await forgot({ email: 'user@example.test' });
		expect(response.status).toBe(200);
		const json = (await response.json()) as { data: { message: string } };
		expect(json.data.message).toBe(FORGOT_PASSWORD_MESSAGE);
	});

	it('answers the same message without sending when the address has had its emails for the hour', async () => {
		enforceRecipient.mockRejectedValue(limitError(RateLimitType.AUTH_EMAIL_RECIPIENT));
		const response = await forgot({ email: 'user@example.test' });
		expect(response.status).toBe(200);
		const json = (await response.json()) as { data: { message: string } };
		expect(json.data.message).toBe(FORGOT_PASSWORD_MESSAGE);
		expect(enforceRecipient).toHaveBeenCalledWith(ENV, DEFAULT_RATE_LIMIT_SETTINGS, 'user@example.test');
		expect(mockRequestPasswordReset).not.toHaveBeenCalled();
	});

	it('counts the client by network address, not by a signed-in user', async () => {
		await forgot({ email: 'user@example.test' });
		expect(enforceClient).toHaveBeenCalledWith(ENV, DEFAULT_RATE_LIMIT_SETTINGS, expect.any(Request), null);
	});

	it('answers 429 without sending when the client has asked too often', async () => {
		enforceClient.mockRejectedValue(limitError(RateLimitType.AUTH_EMAIL));
		const response = await forgot({ email: 'user@example.test' });
		expect(response.status).toBe(429);
		expect(mockRequestPasswordReset).not.toHaveBeenCalled();
	});

	it('answers 400 for a malformed email', async () => {
		const response = await forgot({ email: 'not-an-email' });
		expect(response.status).toBe(400);
		expect(mockRequestPasswordReset).not.toHaveBeenCalled();
	});

	it('answers 403 when email sign-in is switched off', async () => {
		const response = await forgot({ email: 'user@example.test' }, EMAIL_AUTH_OFF);
		expect(response.status).toBe(403);
		expect(mockRequestPasswordReset).not.toHaveBeenCalled();
	});
});

describe('AuthController.resetPassword', () => {
	const body = { token: 'raw-token', newPassword: STRONG_PASSWORD, confirmPassword: STRONG_PASSWORD };

	it('answers 200 once the service has updated the password', async () => {
		const request = post('reset-password', body);
		const response = await AuthController.resetPassword(request, ENV, {} as ExecutionContext, context());
		expect(response.status).toBe(200);
		const json = (await response.json()) as { data: { message: string } };
		expect(json.data.message).toBe('Your password is updated.');
		expect(mockResetPassword).toHaveBeenCalledWith('raw-token', STRONG_PASSWORD, request);
	});

	it('answers 400 with the service message for a bad link', async () => {
		mockResetPassword.mockRejectedValue(new SecurityError(SecurityErrorType.INVALID_TOKEN, RESET_LINK_INVALID_MESSAGE, 400));
		const response = await reset(body);
		expect(response.status).toBe(400);
		const json = (await response.json()) as { error: { message: string } };
		expect(json.error.message).toBe(RESET_LINK_INVALID_MESSAGE);
	});

	it('answers 400 with the rule message for a weak password', async () => {
		mockResetPassword.mockRejectedValue(
			new SecurityError(SecurityErrorType.INVALID_INPUT, 'Password must contain at least one number', 400),
		);
		const response = await reset(body);
		expect(response.status).toBe(400);
		const json = (await response.json()) as { error: { message: string } };
		expect(json.error.message).toBe('Password must contain at least one number');
	});

	it("answers 400 \"Passwords don't match\" without calling the service", async () => {
		const response = await reset({ ...body, confirmPassword: `${STRONG_PASSWORD}x` });
		expect(response.status).toBe(400);
		const json = (await response.json()) as { error: { message: string } };
		expect(json.error.message).toBe("Passwords don't match");
		expect(mockResetPassword).not.toHaveBeenCalled();
	});

	it('answers 400 for a body without a token', async () => {
		const response = await reset({ newPassword: STRONG_PASSWORD, confirmPassword: STRONG_PASSWORD });
		expect(response.status).toBe(400);
		expect(mockResetPassword).not.toHaveBeenCalled();
	});

	it('answers 429 without touching the password when the client has tried too often', async () => {
		enforceClient.mockRejectedValue(limitError(RateLimitType.AUTH_EMAIL));
		const response = await reset(body);
		expect(response.status).toBe(429);
		expect(mockResetPassword).not.toHaveBeenCalled();
		expect(enforceClient).toHaveBeenCalledWith(ENV, DEFAULT_RATE_LIMIT_SETTINGS, expect.any(Request), null);
	});

	it('answers 403 when email sign-in is switched off', async () => {
		const response = await reset(body, EMAIL_AUTH_OFF);
		expect(response.status).toBe(403);
		expect(mockResetPassword).not.toHaveBeenCalled();
	});
});

describe('password reset wiring', () => {
	it.each([
		['/forgot-password', 'AuthController.forgotPassword'],
		['/reset-password', 'AuthController.resetPassword'],
	])('serves %s publicly', (path, handler) => {
		const line = source('/worker/api/routes/authRoutes.ts')
			.split('\n')
			.find((candidate) => candidate.includes(`'${path}'`));
		expect(line).toContain('authRouter.post(');
		expect(line).toContain('setAuthLevel(AuthConfig.public)');
		expect(line).toContain(handler);
	});

	it('limits both handlers per client before any service call', () => {
		const controller = source('/worker/api/controllers/auth/controller.ts');
		const forgotBody = methodBody(controller, 'static async forgotPassword(');
		const resetBody = methodBody(controller, 'static async resetPassword(');
		expect(forgotBody).toContain('enforceAuthEmailRateLimit(');
		expect(forgotBody.indexOf('enforceAuthEmailRateLimit(')).toBeLessThan(forgotBody.indexOf('requestPasswordReset('));
		expect(forgotBody.indexOf('enforceAuthEmailRecipientRateLimit(')).toBeLessThan(forgotBody.indexOf('requestPasswordReset('));
		expect(resetBody).toContain('enforceAuthEmailRateLimit(');
		expect(resetBody.indexOf('enforceAuthEmailRateLimit(')).toBeLessThan(resetBody.indexOf('.resetPassword('));
	});
});
