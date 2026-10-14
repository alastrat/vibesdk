import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteContext } from '../../types/route-context';
import { TERMS_OUTDATED_MESSAGE, TERMS_VERSION } from '../../../../shared/types/legal';

const { mockAcceptTerms } = vi.hoisted(() => ({ mockAcceptTerms: vi.fn() }));

vi.mock('../../../database/services/AuthService', () => ({
	AuthService: vi.fn().mockImplementation(() => ({ acceptTerms: mockAcceptTerms })),
}));

import { AuthController } from './controller';
import { SecurityError, SecurityErrorType } from 'shared/types/errors';

function context(): RouteContext {
	return {
		user: { id: 'user-1', email: 'user@example.com' },
		sessionId: 's1',
		config: {},
		pathParams: {},
		queryParams: new URLSearchParams(),
	} as unknown as RouteContext;
}

function post(body: unknown): Request {
	return new Request('http://localhost/api/auth/accept-terms', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

describe('AuthController.acceptTerms', () => {
	beforeEach(() => {
		mockAcceptTerms.mockReset();
	});

	it('records agreement and returns the updated user', async () => {
		mockAcceptTerms.mockResolvedValue({ id: 'user-1', email: 'user@example.com', termsAccepted: true });
		const response = await AuthController.acceptTerms(post({ version: TERMS_VERSION }), {} as Env, {} as ExecutionContext, context());
		expect(response.status).toBe(200);
		const json = (await response.json()) as { data: { user: { termsAccepted: boolean } } };
		expect(json.data.user.termsAccepted).toBe(true);
		expect(mockAcceptTerms).toHaveBeenCalledWith('user-1', TERMS_VERSION);
	});

	it('answers 400 with the service message for an outdated version', async () => {
		mockAcceptTerms.mockRejectedValue(new SecurityError(SecurityErrorType.INVALID_INPUT, TERMS_OUTDATED_MESSAGE, 400));
		const response = await AuthController.acceptTerms(post({ version: '2020-01-01' }), {} as Env, {} as ExecutionContext, context());
		expect(response.status).toBe(400);
		const json = (await response.json()) as { error: { message: string } };
		expect(json.error.message).toBe(TERMS_OUTDATED_MESSAGE);
	});

	it('answers 400 for a body without a version', async () => {
		const response = await AuthController.acceptTerms(post({}), {} as Env, {} as ExecutionContext, context());
		expect(response.status).toBe(400);
		expect(mockAcceptTerms).not.toHaveBeenCalled();
	});
});
