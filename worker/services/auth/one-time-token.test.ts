import { describe, expect, it } from 'vitest';
import {
	RESET_TOKEN_TTL_MS,
	VERIFY_TOKEN_TTL_MS,
	createOneTimeToken,
	hashOneTimeToken,
	isTokenUsable,
} from './one-time-token';

describe('one-time token lifetimes', () => {
	it('lets a reset link live 30 minutes and a confirmation link 24 hours', () => {
		expect(RESET_TOKEN_TTL_MS).toBe(30 * 60 * 1000);
		expect(VERIFY_TOKEN_TTL_MS).toBe(24 * 60 * 60 * 1000);
	});
});

describe('createOneTimeToken', () => {
	it('is 32 random bytes as 43 unpadded base64url characters', () => {
		expect(createOneTimeToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it('differs on every call', () => {
		expect(createOneTimeToken()).not.toBe(createOneTimeToken());
	});
});

describe('hashOneTimeToken', () => {
	it('is 64 hex characters', async () => {
		expect(await hashOneTimeToken(createOneTimeToken())).toMatch(/^[0-9a-f]{64}$/);
	});

	it('is deterministic and not the token itself', async () => {
		const token = createOneTimeToken();
		const first = await hashOneTimeToken(token);
		expect(await hashOneTimeToken(token)).toBe(first);
		expect(first).not.toBe(token);
	});

	it('matches the known SHA-256 of a fixed input', async () => {
		expect(await hashOneTimeToken('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		);
	});
});

describe('isTokenUsable', () => {
	const now = new Date('2026-10-14T12:00:00Z');

	it('accepts an unused token that has not expired', () => {
		expect(isTokenUsable({ used: false, expiresAt: new Date('2026-10-14T12:00:01Z') }, now)).toBe(true);
	});

	it('treats a null used flag as unused', () => {
		expect(isTokenUsable({ used: null, expiresAt: new Date('2026-10-14T13:00:00Z') }, now)).toBe(true);
	});

	it('rejects a used token', () => {
		expect(isTokenUsable({ used: true, expiresAt: new Date('2026-10-14T13:00:00Z') }, now)).toBe(false);
	});

	it('rejects a token that expires exactly now', () => {
		expect(isTokenUsable({ used: false, expiresAt: new Date(now) }, now)).toBe(false);
	});

	it('rejects an expired token', () => {
		expect(isTokenUsable({ used: false, expiresAt: new Date('2026-10-14T11:59:59Z') }, now)).toBe(false);
	});
});
