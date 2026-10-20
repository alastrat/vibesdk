import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { SecurityError } from 'shared/types/errors';
import { SignupsPausedError } from '../../../shared/types/pauses';
import { AuthService } from './AuthService';
import { SessionService } from './SessionService';
import { recordingD1 } from '../test-support/recording-d1';
import { assignedValues, lastWrite, rejection, rowsByTable, writes, type Row, type Statement } from '../test-support/recorded-statements';
import { expectTakeoverCleanupIn, sessionRevokes, takeoverCleanupWrites } from '../test-support/takeover-cleanup';
import type { BaseOAuthProvider } from '../../services/oauth/base';
import type { AuthUser, OAuthProvider, OAuthUserInfo } from '../../types/auth-types';

const NONCE = 'nonce-1';
const CLOUDFLARE_REFUSAL = 'Sign in with your password, Google or GitHub, then connect Cloudflare from Settings.';

function secondsFromNow(ms: number): number {
	return Math.floor((Date.now() + ms) / 1000);
}

function stateRow(provider: OAuthProvider): Row {
	return {
		id: 'state-row-1',
		state: 'state-1',
		provider,
		redirect_uri: null,
		scopes: '[]',
		user_id: null,
		code_verifier: 'verifier',
		nonce: NONCE,
		created_at: secondsFromNow(0),
		expires_at: secondsFromNow(5 * 60 * 1000),
		is_used: 0,
	};
}

/** An account someone created with a password under the address the provider now reports. */
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

function fakeProvider(provider: OAuthProvider): BaseOAuthProvider {
	const info: OAuthUserInfo = { id: `${provider}-123`, email: 'Owner@Example.test', name: 'Owner', emailVerified: true };
	return {
		exchangeCodeForTokens: async () => ({ accessToken: 'provider-access-token', tokenType: 'Bearer' }),
		getUserInfo: async () => info,
	} as unknown as BaseOAuthProvider;
}

function callbackRequest(provider: OAuthProvider): Request {
	return new Request(`http://localhost/api/auth/callback/${provider}?code=code-1&state=state-1`, {
		headers: { Cookie: `oauth_nonce=${NONCE}`, 'CF-Connecting-IP': '203.0.113.9' },
	});
}

interface SignIn {
	statements: Statement[];
	batches: Statement[][];
	batch: MockInstance<(prepared: object[]) => Promise<unknown[]>>;
	run: Promise<AuthUser>;
}

/** Signs in through a provider with no identity linked yet, so the account is found by its email. */
function signIn(provider: OAuthProvider, account: Row | undefined, extraEnv: Record<string, string> = {}): SignIn {
	const { d1, statements, batches } = recordingD1(rowsByTable({ oauth_states: stateRow(provider), users: account }));
	const batch = vi.spyOn(d1, 'batch');
	vi.spyOn(AuthService.prototype, 'getOauthProvider').mockResolvedValue(fakeProvider(provider));
	const env = { DB: d1, JWT_SECRET: 'test-only-jwt-secret-of-at-least-32-characters', ENVIRONMENT: 'dev', ...extraEnv } as unknown as Env;
	const run = new AuthService(env)
		.handleOAuthCallback(provider, 'code-1', 'state-1', callbackRequest(provider))
		.then((result) => result.user);
	return { statements, batches, batch, run };
}

/** Every write that takes an account away from whoever set its password. */
function claimWrites(statements: Statement[]): Statement[] {
	return [
		...takeoverCleanupWrites(statements),
		...writes(statements, 'insert', 'user_oauth_identities'),
		...writes(statements, 'update', 'users'),
	];
}

let createSession: MockInstance<SessionService['createSession']>;

beforeEach(() => {
	createSession = vi.spyOn(SessionService.prototype, 'createSession');
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('provider sign-in to an existing account with a confirmed email', () => {
	it.each<OAuthProvider>(['google', 'github', 'cloudflare'])(
		'links %s and leaves the password, sessions, other identities, API keys, payouts and model routing alone',
		async (provider) => {
			const { statements, batches, run } = signIn(provider, existingAccount(1));
			const user = await run;

			const identity = assignedValues(lastWrite(statements, 'insert', 'user_oauth_identities'));
			expect(identity.user_id).toBe('user-1');
			expect(identity.provider).toBe(provider);
			expect(identity.provider_id).toBe(`${provider}-123`);

			expect(batches).toEqual([]);
			expect(writes(statements, 'update', 'users')).toEqual([]);
			expect(takeoverCleanupWrites(statements)).toEqual([]);
			expect(user.id).toBe('user-1');
			expect(createSession).toHaveBeenCalledOnce();
		},
	);
});

describe('provider sign-in to an existing account with an unconfirmed email', () => {
	it.each<[OAuthProvider, number | null]>([
		['google', 0],
		['github', 0],
		['google', null],
	])('lets %s (email_verified %s) take the account back from whoever set its password', async (provider, emailVerified) => {
		const { statements, batches, run } = signIn(provider, existingAccount(emailVerified));
		const user = await run;

		const removeIdentities = lastWrite(statements, 'delete', 'user_oauth_identities');
		expect(removeIdentities.params).toEqual(['user-1']);

		const identity = lastWrite(statements, 'insert', 'user_oauth_identities');
		expect(assignedValues(identity).user_id).toBe('user-1');
		expect(assignedValues(identity).provider).toBe(provider);
		expect(assignedValues(identity).provider_id).toBe(`${provider}-123`);
		expect(statements.indexOf(removeIdentities)).toBeLessThan(statements.indexOf(identity));

		const account = lastWrite(statements, 'update', 'users');
		const changes = assignedValues(account);
		expect(changes.password_hash).toBeNull();
		expect(changes.email_verified).toBe(1);
		expect(changes.provider).toBe(provider);
		expect(changes.provider_id).toBe(`${provider}-123`);
		expect(changes.ai_gateway_enabled).toBeNull();
		expect(typeof changes.updated_at).toBe('number');
		expect(account.params.at(-1)).toBe('user-1');

		expect(batches).toHaveLength(1);
		expectTakeoverCleanupIn(batches[0], statements, 'user-1');

		expect(user.id).toBe('user-1');
		expect(user.emailVerified).toBe(true);
		expect(user.provider).toBe(provider);
	});

	it('issues every write of the claim in one batch, so a failure leaves nothing half done', async () => {
		const { statements, batches, run } = signIn('google', existingAccount(0));
		await run;

		const claim = claimWrites(statements);
		expect(claim).toHaveLength(10);
		expect(batches).toHaveLength(1);
		expect(batches[0]).toHaveLength(10);
		for (const write of claim) {
			expect(batches[0]).toContain(write);
		}
	});

	it('signs the account out everywhere before creating the session for this sign-in', async () => {
		const { statements, batch, run } = signIn('google', existingAccount(0));
		await run;

		expect(createSession).toHaveBeenCalledOnce();
		expect(batch.mock.invocationCallOrder[0]).toBeLessThan(createSession.mock.invocationCallOrder[0]);
		const [revoke] = sessionRevokes(statements);
		expect(statements.indexOf(revoke)).toBeLessThan(statements.indexOf(lastWrite(statements, 'insert', 'sessions')));
	});

	it('refuses Cloudflare, which does not verify the email itself, and changes nothing', async () => {
		const { statements, batches, run } = signIn('cloudflare', existingAccount(0));
		const error = await rejection(run);

		expect(error).toBeInstanceOf(SecurityError);
		expect((error as SecurityError).statusCode).toBe(409);
		expect((error as SecurityError).message).toBe(CLOUDFLARE_REFUSAL);
		expect(batches).toEqual([]);
		expect(claimWrites(statements)).toEqual([]);
		expect(createSession).not.toHaveBeenCalled();
	});
});

describe('provider sign-in while sign-ups are paused', () => {
	const PAUSED = { FEATURE_FLAG_OVERRIDES: 'signups-paused=on' };

	it('refuses a new account, creating no user, identity or session', async () => {
		const { statements, run } = signIn('google', undefined, PAUSED);
		await expect(run).rejects.toBeInstanceOf(SignupsPausedError);
		expect(writes(statements, 'insert', 'users')).toEqual([]);
		expect(writes(statements, 'insert', 'user_oauth_identities')).toEqual([]);
		expect(createSession).not.toHaveBeenCalled();
	});

	it('still signs in an existing account', async () => {
		const { run } = signIn('google', existingAccount(1), PAUSED);
		expect((await run).id).toBe('user-1');
		expect(createSession).toHaveBeenCalledOnce();
	});
});
