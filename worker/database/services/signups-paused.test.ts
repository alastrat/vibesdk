/** Email sign-up while sign-ups are paused: refused before any account exists. */
import { describe, expect, it } from 'vitest';
import { TERMS_VERSION } from '../../../shared/types/legal';
import { SIGNUPS_PAUSED_MESSAGE, SignupsPausedError } from '../../../shared/types/pauses';
import { AuthService } from './AuthService';
import { recordingD1 } from '../test-support/recording-d1';
import { writes } from '../test-support/recorded-statements';

const SIGN_UP = { email: 'new@example.test', password: 'A-new-Passw0rd-for-Estori', name: 'New Person', acceptedTermsVersion: TERMS_VERSION };
const REQUEST = new Request('http://localhost/api/auth/register', { method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.9' } });

describe('email sign-up while sign-ups are paused', () => {
	it('is refused with the pause message, and no account or session is created', async () => {
		const { d1, statements } = recordingD1(() => []);
		const env = { DB: d1, JWT_SECRET: 'test-only-jwt-secret-of-at-least-32-characters', FEATURE_FLAG_OVERRIDES: 'signups-paused=on' } as unknown as Env;
		const error = await new AuthService(env).register(SIGN_UP, REQUEST, null, 'https://estori.app').catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(SignupsPausedError);
		expect(error).toMatchObject({ message: SIGNUPS_PAUSED_MESSAGE, statusCode: 503 });
		expect(writes(statements, 'insert', 'users')).toEqual([]);
		expect(writes(statements, 'insert', 'sessions')).toEqual([]);
	});
});
