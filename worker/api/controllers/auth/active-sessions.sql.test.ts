import { beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import {
	envWith,
	insertUser,
	migratedD1,
} from '../../../database/test-support/real-d1';
import * as schema from '../../../database/schema';
import type { RouteContext } from '../../types/route-context';
import { AuthController } from './controller';

let db: D1Database;
const user = {
	id: 'sessions-owner',
	email: 'owner@example.test',
	locale: null,
};
beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, user.id);
	await insertUser(db, 'other-owner');
	const now = new Date();
	const future = new Date(now.getTime() + 60_000);
	const past = new Date(now.getTime() - 60_000);
	await drizzle(db)
		.insert(schema.sessions)
		.values(
			[
				{
					id: 'current-browser',
					userId: user.id,
					expiresAt: future,
					isRevoked: false,
				},
				{
					id: 'another-browser',
					userId: user.id,
					expiresAt: future,
					isRevoked: false,
				},
				{
					id: 'expired-browser',
					userId: user.id,
					expiresAt: past,
					isRevoked: false,
				},
				{
					id: 'revoked-browser',
					userId: user.id,
					expiresAt: future,
					isRevoked: true,
				},
				{
					id: 'foreign-browser',
					userId: 'other-owner',
					expiresAt: future,
					isRevoked: false,
				},
			].map((session) => ({
				...session,
				accessTokenHash: `access-${session.id}`,
				refreshTokenHash: `refresh-${session.id}`,
				userAgent: 'Same browser agent',
				ipAddress: '192.0.2.1',
				createdAt: now,
				lastActivity: now,
			})),
		);
});

function context(sessionId: string | null, authenticated = true): RouteContext {
	return {
		user: authenticated ? user : null,
		sessionId,
		config: {} as RouteContext['config'],
		pathParams: {},
		queryParams: new URLSearchParams(),
	};
}
async function responseFor(sessionId: string | null, authenticated = true) {
	return AuthController.getActiveSessions(
		new Request('https://estori.app/api/auth/sessions'),
		envWith(db, {
			JWT_SECRET: 'test-only-jwt-secret-of-at-least-32-characters',
		}),
		{} as ExecutionContext,
		context(sessionId, authenticated),
	);
}

describe('active-session current-device identification', () => {
	it('marks only the authenticated session, even when devices share an IP address and user agent', async () => {
		const response = await responseFor('current-browser');
		expect(response.status).toBe(200);
		const body = await response.json<{
			data: { sessions: Array<{ id: string; isCurrent: boolean }> };
		}>();
		expect(body.data.sessions).toHaveLength(2);
		expect(body.data.sessions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: 'current-browser',
					isCurrent: true,
				}),
				expect.objectContaining({
					id: 'another-browser',
					isCurrent: false,
				}),
			]),
		);
	});

	it('updates the marker when the same account requests the list from another session', async () => {
		const response = await responseFor('another-browser');
		const body = await response.json<{
			data: { sessions: Array<{ id: string; isCurrent: boolean }> };
		}>();
		expect(
			body.data.sessions
				.filter((session) => session.isCurrent)
				.map((session) => session.id),
		).toEqual(['another-browser']);
	});

	it('does not guess a current device when authentication has no matching browser session', async () => {
		for (const sessionId of [
			null,
			'api-key-authentication',
			'foreign-browser',
		]) {
			const response = await responseFor(sessionId);
			const body = await response.json<{
				data: { sessions: Array<{ id: string; isCurrent: boolean }> };
			}>();
			expect(
				body.data.sessions.every(
					(session) => session.isCurrent === false,
				),
			).toBe(true);
		}
	});

	it('does not return sessions to an unauthenticated request', async () => {
		const response = await responseFor(null, false);
		expect(response.status).toBe(401);
		expect(await response.json()).not.toHaveProperty('data.sessions');
	});
});
