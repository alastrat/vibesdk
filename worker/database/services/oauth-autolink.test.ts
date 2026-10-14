import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { AuthService } from './AuthService';
import { SessionService } from './SessionService';
import { recordingD1 } from '../test-support/recording-d1';
import { assignedValues, lastWrite, rowsByTable, writes, type Row, type Statement } from '../test-support/recorded-statements';
import type { BaseOAuthProvider } from '../../services/oauth/base';
import type { OAuthUserInfo } from '../../types/auth-types';

const NONCE = 'nonce-1';
const GOOGLE_USER: OAuthUserInfo = { id: 'google-123', email: 'Owner@Example.test', name: 'Owner', emailVerified: true };

function secondsFromNow(ms: number): number {
	return Math.floor((Date.now() + ms) / 1000);
}

const STATE: Row = {
	id: 'state-row-1',
	state: 'state-1',
	provider: 'google',
	redirect_uri: null,
	scopes: '[]',
	user_id: null,
	code_verifier: 'verifier',
	nonce: NONCE,
	created_at: secondsFromNow(0),
	expires_at: secondsFromNow(5 * 60 * 1000),
	is_used: 0,
};

/** An account someone created with a password under the address the provider has now verified. */
function existingAccount(emailVerified: number | null): Row {
	return {
		id: 'user-1',
		email: 'owner@example.test',
		password_hash: 'password-set-at-sign-up',
		email_verified: emailVerified,
		provider: 'email',
		provider_id: 'user-1',
		display_name: 'Someone',
		is_active: 1,
		is_suspended: 0,
	};
}

const fakeGoogle = {
	exchangeCodeForTokens: async () => ({ accessToken: 'provider-access-token', tokenType: 'Bearer' }),
	getUserInfo: async () => GOOGLE_USER,
} as unknown as BaseOAuthProvider;

function callbackRequest(): Request {
	return new Request('http://localhost/api/auth/callback/google?code=code-1&state=state-1', {
		headers: { Cookie: `oauth_nonce=${NONCE}`, 'CF-Connecting-IP': '203.0.113.9' },
	});
}

/** Signs in through Google with no identity linked yet, so the account is found by its email. */
async function signInWithGoogle(account: Row): Promise<{ statements: Statement[]; userId: string; emailVerified: boolean | undefined }> {
	const { d1, statements } = recordingD1(rowsByTable({ oauth_states: STATE, users: account }));
	const env = { DB: d1, JWT_SECRET: 'test-only-jwt-secret-of-at-least-32-characters', ENVIRONMENT: 'dev' } as unknown as Env;
	const result = await new AuthService(env).handleOAuthCallback('google', 'code-1', 'state-1', callbackRequest());
	return { statements, userId: result.user.id, emailVerified: result.user.emailVerified };
}

function sessionRevokeIndex(statements: Statement[]): number {
	return statements.findIndex((entry) => entry.sql.toLowerCase().startsWith('update "sessions"') && entry.params.includes('user_force_logout'));
}

let revokeAll: MockInstance<SessionService['revokeAllUserSessions']>;
let createSession: MockInstance<SessionService['createSession']>;

beforeEach(() => {
	vi.spyOn(AuthService.prototype, 'getOauthProvider').mockResolvedValue(fakeGoogle);
	revokeAll = vi.spyOn(SessionService.prototype, 'revokeAllUserSessions');
	createSession = vi.spyOn(SessionService.prototype, 'createSession');
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('provider sign-in to an existing account with the same email', () => {
	it('links the provider to a confirmed account and leaves its password and sessions alone', async () => {
		const { statements, userId } = await signInWithGoogle(existingAccount(1));

		const identity = assignedValues(lastWrite(statements, 'insert', 'user_oauth_identities'));
		expect(identity.user_id).toBe('user-1');
		expect(identity.provider).toBe('google');
		expect(identity.provider_id).toBe('google-123');

		expect(writes(statements, 'update', 'users')).toEqual([]);
		expect(revokeAll).not.toHaveBeenCalled();
		expect(sessionRevokeIndex(statements)).toBe(-1);
		expect(userId).toBe('user-1');
		expect(createSession).toHaveBeenCalledOnce();
	});

	it.each([
		['unconfirmed', 0],
		['never marked either way', null],
	])('takes an %s account back from whoever set its password', async (_label, emailVerified) => {
		const { statements, userId, emailVerified: confirmedInResult } = await signInWithGoogle(existingAccount(emailVerified));

		const identity = assignedValues(lastWrite(statements, 'insert', 'user_oauth_identities'));
		expect(identity.user_id).toBe('user-1');
		expect(identity.provider_id).toBe('google-123');

		const claim = lastWrite(statements, 'update', 'users');
		const changes = assignedValues(claim);
		expect(changes.password_hash).toBeNull();
		expect(changes.email_verified).toBe(1);
		expect(typeof changes.updated_at).toBe('number');
		expect(claim.params).toContain('user-1');

		expect(revokeAll).toHaveBeenCalledOnce();
		expect(revokeAll).toHaveBeenCalledWith('user-1');
		expect(userId).toBe('user-1');
		expect(confirmedInResult).toBe(true);
	});

	it('signs out the account everywhere before creating the session for this sign-in', async () => {
		const { statements } = await signInWithGoogle(existingAccount(0));

		expect(createSession).toHaveBeenCalledOnce();
		expect(revokeAll.mock.invocationCallOrder[0]).toBeLessThan(createSession.mock.invocationCallOrder[0]);

		const revokeIndex = sessionRevokeIndex(statements);
		const newSessionIndex = statements.indexOf(lastWrite(statements, 'insert', 'sessions'));
		expect(revokeIndex).toBeGreaterThan(-1);
		expect(revokeIndex).toBeLessThan(newSessionIndex);
		expect(statements.indexOf(lastWrite(statements, 'update', 'users'))).toBeLessThan(revokeIndex);
	});
});
