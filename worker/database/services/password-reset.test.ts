import { describe, expect, it, vi } from 'vitest';
import { SecurityError } from 'shared/types/errors';
import { AuthService } from './AuthService';
import { recordingD1 } from '../test-support/recording-d1';
import { lastWrite, recordingSender, rejection, rowsByTable, writes, type Row, type Statement } from '../test-support/recorded-statements';
import { RESET_LINK_INVALID_MESSAGE, RESET_TOKEN_TTL_MS, hashOneTimeToken } from '../../services/auth/one-time-token';
import { sha256Hash } from '../../utils/cryptoUtils';
import { PasswordService } from '../../utils/passwordService';

const REQUEST = new Request('http://localhost/api/auth/reset-password', { method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.9' } });
const USER = { id: 'user-1', email: 'user@example.test', password_hash: 'stored-hash' };
const STRONG_PASSWORD = 'A-new-Passw0rd-for-Estori';

function secondsFromNow(ms: number): number {
	return Math.floor((Date.now() + ms) / 1000);
}

function validTokenRow(overrides: Row = {}): Row {
	return { id: 'token-1', user_id: USER.id, used: 0, expires_at: secondsFromNow(10 * 60 * 1000), ...overrides };
}

/** `claim: false` makes the atomic token claim (`update ... returning`) match no row, as when another request used the token first. */
function serviceWith(
	tables: Record<string, Row | undefined>,
	options: { claim?: boolean } = {},
): { auth: AuthService; statements: Statement[] } {
	const { claim = true } = options;
	const selects = rowsByTable(tables);
	const rows = (sql: string): unknown[][] => {
		const lower = sql.toLowerCase();
		if (lower.startsWith('update "password_reset_tokens"') && lower.includes(' returning ')) {
			return claim ? [['token-1']] : [];
		}
		return selects(sql);
	};
	const { d1, statements } = recordingD1(rows);
	return { auth: new AuthService({ DB: d1, JWT_SECRET: 'test-only-jwt-secret-of-at-least-32-characters' } as unknown as Env), statements };
}

describe('AuthService.requestPasswordReset', () => {
	it('sends nothing and stores nothing for an unknown email', async () => {
		const { auth, statements } = serviceWith({ users: undefined });
		const { sender, sent } = recordingSender();
		await auth.requestPasswordReset('nobody@example.test', sender, 'https://estori.app');
		expect(sent).toEqual([]);
		expect(writes(statements, 'insert', 'password_reset_tokens')).toEqual([]);
		expect(writes(statements, 'update', 'password_reset_tokens')).toEqual([]);
	});

	it('sends nothing for an account that signs in only through a provider', async () => {
		const { auth, statements } = serviceWith({ users: { ...USER, password_hash: null } });
		const { sender, sent } = recordingSender();
		await auth.requestPasswordReset(USER.email, sender, 'https://estori.app');
		expect(sent).toEqual([]);
		expect(writes(statements, 'insert', 'password_reset_tokens')).toEqual([]);
	});

	it('stores nothing when email sending is unavailable', async () => {
		const { auth, statements } = serviceWith({ users: USER });
		await auth.requestPasswordReset(USER.email, null, 'https://estori.app');
		expect(writes(statements, 'insert', 'password_reset_tokens')).toEqual([]);
	});

	it('looks the account up by the lowercased email', async () => {
		const { auth, statements } = serviceWith({ users: USER });
		const { sender } = recordingSender();
		await auth.requestPasswordReset('User@Example.TEST', sender, 'https://estori.app');
		expect(statements[0].params).toContain(USER.email);
	});

	it('retires earlier unused tokens, stores only the hash of a new one, and emails the raw token', async () => {
		const { auth, statements } = serviceWith({ users: USER });
		const { sender, sent } = recordingSender();
		await auth.requestPasswordReset(USER.email, sender, 'https://estori.app');

		const retire = lastWrite(statements, 'update', 'password_reset_tokens');
		expect(retire.sql.toLowerCase()).toContain('set "used" = ?');
		expect(retire.params).toContain(USER.id);

		const insert = lastWrite(statements, 'insert', 'password_reset_tokens');
		const storedHash = insert.params.find((param) => typeof param === 'string' && /^[0-9a-f]{64}$/.test(param));
		expect(storedHash).toBeDefined();
		expect(insert.params).toContain(USER.id);

		expect(sent).toHaveLength(1);
		expect(sent[0].to).toBe(USER.email);
		expect(sent[0].subject).toBe('Reset your Estori password');
		const rawToken = new URL(sent[0].text.match(/https:\/\/\S+/)?.[0] ?? '').searchParams.get('token');
		expect(rawToken).toBeTruthy();
		expect(sent[0].text).toContain('https://estori.app/reset-password?token=');
		expect(insert.params).not.toContain(rawToken);
		expect(JSON.stringify(insert.params)).not.toContain(rawToken as string);
		expect(await sha256Hash(rawToken as string)).toBe(storedHash);
	});

	it('expires the new token after the reset window', async () => {
		const { auth, statements } = serviceWith({ users: USER });
		const { sender } = recordingSender();
		await auth.requestPasswordReset(USER.email, sender, 'https://estori.app');
		const insert = lastWrite(statements, 'insert', 'password_reset_tokens');
		const expiry = insert.params.find((param): param is number => typeof param === 'number' && param > 1_000_000_000);
		expect(expiry).toBeDefined();
		expect(Math.abs((expiry as number) - secondsFromNow(RESET_TOKEN_TTL_MS))).toBeLessThanOrEqual(5);
	});

	it('does not throw when the email cannot be sent', async () => {
		const { auth, statements } = serviceWith({ users: USER });
		const send = vi.fn().mockRejectedValue(new Error('Email Service unavailable'));
		await expect(auth.requestPasswordReset(USER.email, { send }, 'https://estori.app')).resolves.toBeUndefined();
		expect(send).toHaveBeenCalledOnce();
		expect(writes(statements, 'insert', 'password_reset_tokens')).toHaveLength(1);
	});
});

describe('AuthService.resetPassword', () => {
	it('looks the token up by its hash, never the raw value', async () => {
		const { auth, statements } = serviceWith({ password_reset_tokens: undefined });
		await rejection(auth.resetPassword('raw-token-value', STRONG_PASSWORD, REQUEST));
		expect(statements[0].params).toContain(await hashOneTimeToken('raw-token-value'));
		expect(JSON.stringify(statements.map((entry) => entry.params))).not.toContain('raw-token-value');
	});

	it.each([
		['an unknown', undefined],
		['a used', validTokenRow({ used: 1 })],
		['an expired', validTokenRow({ expires_at: secondsFromNow(-60 * 1000) })],
	])('rejects %s token with the invalid-link message and changes nothing', async (_label, tokenRow) => {
		const { auth, statements } = serviceWith({ password_reset_tokens: tokenRow, users: USER });
		const error = await rejection(auth.resetPassword('some-token', STRONG_PASSWORD, REQUEST));
		expect(error).toBeInstanceOf(SecurityError);
		expect((error as SecurityError).message).toBe(RESET_LINK_INVALID_MESSAGE);
		expect((error as SecurityError).statusCode).toBe(400);
		expect(writes(statements, 'update', 'users')).toEqual([]);
		expect(writes(statements, 'update', 'sessions')).toEqual([]);
	});

	it('rejects a token whose account no longer exists', async () => {
		const { auth, statements } = serviceWith({ password_reset_tokens: validTokenRow(), users: undefined });
		const error = await rejection(auth.resetPassword('some-token', STRONG_PASSWORD, REQUEST));
		expect((error as SecurityError).message).toBe(RESET_LINK_INVALID_MESSAGE);
		expect(writes(statements, 'update', 'users')).toEqual([]);
	});

	it('rejects a weak password with the rule message, leaving the password and token alone', async () => {
		const { auth, statements } = serviceWith({ password_reset_tokens: validTokenRow(), users: USER });
		const error = await rejection(auth.resetPassword('some-token', 'short', REQUEST));
		expect(error).toBeInstanceOf(SecurityError);
		expect((error as SecurityError).statusCode).toBe(400);
		expect((error as SecurityError).message).toContain('Password must be at least 8 characters');
		expect(writes(statements, 'update', 'users')).toEqual([]);
		expect(writes(statements, 'update', 'password_reset_tokens')).toEqual([]);
		expect(writes(statements, 'update', 'sessions')).toEqual([]);
	});

	it('sets the new password, clears the lock, uses the token and signs every session out', async () => {
		const { auth, statements } = serviceWith({ password_reset_tokens: validTokenRow(), users: USER });
		await auth.resetPassword('some-token', STRONG_PASSWORD, REQUEST);

		const userUpdate = lastWrite(statements, 'update', 'users');
		const sql = userUpdate.sql.toLowerCase();
		for (const column of ['password_hash', 'password_changed_at', 'failed_login_attempts', 'locked_until', 'updated_at']) {
			expect(sql).toContain(`"${column}" = ?`);
		}
		expect(userUpdate.params).toContain(0);
		expect(userUpdate.params).toContain(null);
		expect(userUpdate.params).toContain(USER.id);
		expect(JSON.stringify(userUpdate.params)).not.toContain(STRONG_PASSWORD);
		const newHash = userUpdate.params.find((param): param is string => typeof param === 'string' && param !== USER.id);
		expect(newHash).toBeDefined();
		expect(await new PasswordService().verify(STRONG_PASSWORD, newHash as string)).toBe(true);

		const tokenUpdate = lastWrite(statements, 'update', 'password_reset_tokens');
		expect(tokenUpdate.sql.toLowerCase()).toContain('set "used" = ?');
		expect(tokenUpdate.params).toContain('token-1');

		const sessionUpdate = lastWrite(statements, 'update', 'sessions');
		expect(sessionUpdate.params).toContain(USER.id);
		expect(sessionUpdate.params).toContain('user_force_logout');
	});

	it('claims the token in one statement that requires it unused and unexpired, before changing the password', async () => {
		const { auth, statements } = serviceWith({ password_reset_tokens: validTokenRow(), users: USER });
		const before = Math.floor(Date.now() / 1000);
		await auth.resetPassword('some-token', STRONG_PASSWORD, REQUEST);

		const claimIndex = statements.findIndex(
			(entry) => entry.sql.toLowerCase().startsWith('update "password_reset_tokens"') && entry.sql.toLowerCase().includes(' returning '),
		);
		expect(claimIndex).toBeGreaterThan(-1);
		const claim = statements[claimIndex];
		const condition = claim.sql.toLowerCase().slice(claim.sql.toLowerCase().indexOf(' where '));
		expect(condition).toContain('"id" = ?');
		expect(condition).toContain('"used" = ?');
		expect(condition).toContain('"used" is null');
		expect(condition).toContain('"expires_at" > ?');
		expect(claim.params).toContain('token-1');
		const expiryBound = claim.params.find((param): param is number => typeof param === 'number' && param > 1_000_000_000);
		expect(expiryBound).toBeGreaterThanOrEqual(before);

		const userUpdateIndex = statements.findIndex((entry) => entry.sql.toLowerCase().startsWith('update "users"'));
		expect(userUpdateIndex).toBeGreaterThan(claimIndex);
		expect(writes(statements, 'update', 'password_reset_tokens')).toHaveLength(1);
	});

	it('changes nothing when another request claimed the token first', async () => {
		const { auth, statements } = serviceWith({ password_reset_tokens: validTokenRow(), users: USER }, { claim: false });
		const error = await rejection(auth.resetPassword('some-token', STRONG_PASSWORD, REQUEST));
		expect(error).toBeInstanceOf(SecurityError);
		expect((error as SecurityError).message).toBe(RESET_LINK_INVALID_MESSAGE);
		expect((error as SecurityError).statusCode).toBe(400);
		expect(writes(statements, 'update', 'users')).toEqual([]);
		expect(writes(statements, 'update', 'sessions')).toEqual([]);
		expect(writes(statements, 'insert', 'auth_attempts')).toEqual([]);
	});

	it('records the reset as an auth attempt from the requesting address', async () => {
		const { auth, statements } = serviceWith({ password_reset_tokens: validTokenRow(), users: USER });
		await auth.resetPassword('some-token', STRONG_PASSWORD, REQUEST);
		const attempt = lastWrite(statements, 'insert', 'auth_attempts');
		expect(attempt.params).toContain('reset_password');
		expect(attempt.params).toContain(USER.email);
		expect(attempt.params).toContain('203.0.113.9');
	});
});
