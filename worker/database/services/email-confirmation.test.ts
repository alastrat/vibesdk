import { describe, expect, it, vi } from 'vitest';
import { SecurityError } from 'shared/types/errors';
import { TERMS_VERSION } from '../../../shared/types/legal';
import { AuthService } from './AuthService';
import { recordingD1 } from '../test-support/recording-d1';
import {
	assignedValues,
	lastWrite,
	recordingSender,
	rejection,
	rowsByTable,
	tokenFromEmail,
	writes,
	type Row,
	type Statement,
} from '../test-support/recorded-statements';
import { CONFIRM_LINK_INVALID_MESSAGE, VERIFY_TOKEN_TTL_MS, hashOneTimeToken } from '../../services/auth/one-time-token';

const JWT_SECRET = 'test-only-jwt-secret-of-at-least-32-characters';
const BASE_URL = 'https://estori.app';
const STRONG_PASSWORD = 'A-new-Passw0rd-for-Estori';
const REQUEST = new Request('http://localhost/api/auth/register', { method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.9' } });
const SIGN_UP = { email: 'New@Example.test', password: STRONG_PASSWORD, name: 'New Person', acceptedTermsVersion: TERMS_VERSION };
const CREATED_USER: Row = { id: 'user-1', email: 'new@example.test', password_hash: 'stored-hash', email_verified: 0, provider: 'email', display_name: 'New Person' };
const USER: Row = { id: 'user-1', email: 'user@example.test', password_hash: 'stored-hash', email_verified: 0 };

function secondsFromNow(ms: number): number {
	return Math.floor((Date.now() + ms) / 1000);
}

function tokenRow(overrides: Row = {}): Row {
	return { id: 'confirm-1', user_id: 'user-1', email: USER.email, used: 0, expires_at: secondsFromNow(60 * 60 * 1000), ...overrides };
}

function isClaim(entry: Statement): boolean {
	const lower = entry.sql.toLowerCase();
	return lower.startsWith('update "email_verification_tokens"') && lower.includes(' returning ');
}

function whereClause(entry: Statement): string {
	const lower = entry.sql.toLowerCase();
	return lower.slice(lower.indexOf(' where '));
}

/**
 * A service over a recording database. `claim: false` makes the atomic token claim match no row, as when
 * another request used the token first; `batchFails` makes every batch throw, as when D1 is unavailable.
 */
function serviceWith(
	selects: (sql: string) => unknown[][],
	options: { claim?: boolean; batchFails?: boolean } = {},
): { auth: AuthService; statements: Statement[] } {
	const { claim = true, batchFails = false } = options;
	const { d1, statements } = recordingD1((sql) => (isClaim({ sql, params: [] }) ? (claim ? [['confirm-1']] : []) : selects(sql)));
	if (batchFails) {
		d1.batch = async () => {
			throw new Error('D1 is unavailable');
		};
	}
	return { auth: new AuthService({ DB: d1, JWT_SECRET } as unknown as Env), statements };
}

/** Sign-up finds no account under the email, then reads back the one it created. */
function signUpService(options: { batchFails?: boolean } = {}) {
	const created = rowsByTable({ users: CREATED_USER });
	return serviceWith((sql) => (sql.toLowerCase().includes('where "users"."email" = ?') ? [] : created(sql)), options);
}

describe('AuthService.register', () => {
	it('stores the new account unconfirmed and sends one confirmation email for its address', async () => {
		const { auth, statements } = signUpService();
		const { sender, sent } = recordingSender();
		const result = await auth.register(SIGN_UP, REQUEST, sender, BASE_URL);

		const account = assignedValues(lastWrite(statements, 'insert', 'users'));
		expect(account.email).toBe('new@example.test');
		expect(account.email_verified).toBe(0);

		expect(sent).toHaveLength(1);
		expect(sent[0].to).toBe('new@example.test');
		expect(sent[0].subject).toBe('Confirm your email for Estori');
		expect(sent[0].text).toContain(`${BASE_URL}/verify-email?token=`);

		const rawToken = tokenFromEmail(sent[0]);
		const stored = assignedValues(lastWrite(statements, 'insert', 'email_verification_tokens'));
		expect(stored.user_id).toBe('user-1');
		expect(stored.email).toBe('new@example.test');
		expect(stored.token_hash).toBe(await hashOneTimeToken(rawToken));
		expect(JSON.stringify(statements.map((entry) => entry.params))).not.toContain(rawToken);
		expect(Math.abs((stored.expires_at as number) - secondsFromNow(VERIFY_TOKEN_TTL_MS))).toBeLessThanOrEqual(5);

		expect(result.user.id).toBe('user-1');
		expect(result.accessToken).toBeTruthy();
	});

	it('still signs the user up when the email cannot be sent', async () => {
		const { auth, statements } = signUpService();
		const send = vi.fn().mockRejectedValue(new Error('Email Service unavailable'));
		const result = await auth.register(SIGN_UP, REQUEST, { send }, BASE_URL);

		expect(send).toHaveBeenCalledOnce();
		expect(result.accessToken).toBeTruthy();
		expect(writes(statements, 'insert', 'sessions')).toHaveLength(1);
		const attempts = writes(statements, 'insert', 'auth_attempts').map(assignedValues);
		expect(attempts.map((attempt) => attempt.success)).toEqual([1]);
	});

	it('still signs the user up when the confirmation link cannot be stored', async () => {
		const { auth, statements } = signUpService({ batchFails: true });
		const { sender, sent } = recordingSender();
		const result = await auth.register(SIGN_UP, REQUEST, sender, BASE_URL);

		expect(result.accessToken).toBeTruthy();
		expect(sent).toEqual([]);
		expect(writes(statements, 'insert', 'sessions')).toHaveLength(1);
	});

	it('stores the account unconfirmed and stores no link when email sending is unavailable', async () => {
		const { auth, statements } = signUpService();
		await auth.register(SIGN_UP, REQUEST, null, BASE_URL);

		expect(assignedValues(lastWrite(statements, 'insert', 'users')).email_verified).toBe(0);
		expect(writes(statements, 'insert', 'email_verification_tokens')).toEqual([]);
	});
});

describe('AuthService.verifyEmail', () => {
	it('looks the token up by its hash, never the raw value', async () => {
		const { auth, statements } = serviceWith(rowsByTable({}));
		await rejection(auth.verifyEmail('raw-token-value'));
		expect(statements[0].params).toContain(await hashOneTimeToken('raw-token-value'));
		expect(JSON.stringify(statements.map((entry) => entry.params))).not.toContain('raw-token-value');
	});

	it.each([
		['an unknown token', undefined, USER],
		['a used token', tokenRow({ used: 1 }), USER],
		['an expired token', tokenRow({ expires_at: secondsFromNow(-60 * 1000) }), USER],
		['a token sent to an earlier address', tokenRow({ email: 'old@example.test' }), USER],
		['a token whose account is gone', tokenRow(), undefined],
	])('rejects %s with the invalid-link message and confirms nothing', async (_label, token, user) => {
		const { auth, statements } = serviceWith(rowsByTable({ email_verification_tokens: token, users: user }));
		const error = await rejection(auth.verifyEmail('some-token'));

		expect(error).toBeInstanceOf(SecurityError);
		expect((error as SecurityError).message).toBe(CONFIRM_LINK_INVALID_MESSAGE);
		expect((error as SecurityError).statusCode).toBe(400);
		expect(writes(statements, 'update', 'users')).toEqual([]);
		expect(writes(statements, 'update', 'email_verification_tokens')).toEqual([]);
	});

	it('claims the token in one statement that requires it unused and unexpired, then confirms that address', async () => {
		const { auth, statements } = serviceWith(rowsByTable({ email_verification_tokens: tokenRow(), users: USER }));
		const before = Math.floor(Date.now() / 1000);
		await auth.verifyEmail('some-token');

		const claimIndex = statements.findIndex(isClaim);
		expect(claimIndex).toBeGreaterThan(-1);
		const claim = statements[claimIndex];
		expect(assignedValues(claim).used).toBe(1);
		const condition = whereClause(claim);
		expect(condition).toContain('"id" = ?');
		expect(condition).toContain('"used" = ?');
		expect(condition).toContain('"used" is null');
		expect(condition).toContain('"expires_at" > ?');
		expect(claim.params).toContain('confirm-1');
		const expiryBound = claim.params.find((param): param is number => typeof param === 'number' && param > 1_000_000_000);
		expect(expiryBound).toBeGreaterThanOrEqual(before);
		expect(writes(statements, 'update', 'email_verification_tokens')).toHaveLength(1);

		const confirm = lastWrite(statements, 'update', 'users');
		expect(statements.indexOf(confirm)).toBeGreaterThan(claimIndex);
		expect(assignedValues(confirm).email_verified).toBe(1);
		expect(whereClause(confirm)).toContain('"id" = ?');
		expect(whereClause(confirm)).toContain('"email" = ?');
		expect(confirm.params).toContain('user-1');
		expect(confirm.params).toContain(USER.email);
	});

	it('confirms nothing when another request claimed the token first', async () => {
		const { auth, statements } = serviceWith(rowsByTable({ email_verification_tokens: tokenRow(), users: USER }), { claim: false });
		const error = await rejection(auth.verifyEmail('some-token'));

		expect((error as SecurityError).message).toBe(CONFIRM_LINK_INVALID_MESSAGE);
		expect((error as SecurityError).statusCode).toBe(400);
		expect(writes(statements, 'update', 'users')).toEqual([]);
	});
});

describe('AuthService.resendEmailConfirmation', () => {
	it.each([
		['a confirmed account', { ...USER, email_verified: 1 }],
		['an account that signs in only through a provider', { ...USER, password_hash: null }],
		['an unknown account', undefined],
	])('sends nothing and stores nothing for %s', async (_label, user) => {
		const { auth, statements } = serviceWith(rowsByTable({ users: user }));
		const { sender, sent } = recordingSender();
		await auth.resendEmailConfirmation('user-1', sender, BASE_URL);

		expect(sent).toEqual([]);
		expect(writes(statements, 'insert', 'email_verification_tokens')).toEqual([]);
		expect(writes(statements, 'update', 'email_verification_tokens')).toEqual([]);
	});

	it('stores nothing when email sending is unavailable', async () => {
		const { auth, statements } = serviceWith(rowsByTable({ users: USER }));
		await auth.resendEmailConfirmation('user-1', null, BASE_URL);
		expect(writes(statements, 'insert', 'email_verification_tokens')).toEqual([]);
	});

	it('retires the earlier unused links before storing a new one, and emails it to the current address', async () => {
		const { auth, statements } = serviceWith(rowsByTable({ users: USER }));
		const { sender, sent } = recordingSender();
		await auth.resendEmailConfirmation('user-1', sender, BASE_URL);

		const retire = lastWrite(statements, 'update', 'email_verification_tokens');
		expect(assignedValues(retire).used).toBe(1);
		expect(whereClause(retire)).toContain('"user_id" = ?');
		expect(whereClause(retire)).toContain('"used" is null');
		expect(retire.params).toContain('user-1');

		const insert = lastWrite(statements, 'insert', 'email_verification_tokens');
		expect(statements.indexOf(retire)).toBeLessThan(statements.indexOf(insert));
		const stored = assignedValues(insert);
		expect(stored.email).toBe(USER.email);
		expect(stored.used).not.toBe(1);

		expect(sent).toHaveLength(1);
		expect(sent[0].to).toBe(USER.email);
		expect(stored.token_hash).toBe(await hashOneTimeToken(tokenFromEmail(sent[0])));
	});
});
