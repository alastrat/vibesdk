/** The saved language on real SQL: kept in `users.preferences` beside whatever else is there. */
import { beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { envWith, insertUser, migratedD1 } from '../test-support/real-d1';
import * as schema from '../schema';
import { LocalePreferenceService } from './LocalePreferenceService';
import { AuthService } from './AuthService';
import { mapUserResponse } from '../../utils/authUtils';
import { AuthController } from '../../api/controllers/auth/controller';
import type { RouteContext } from '../../api/types/route-context';

const JWT_SECRET = 'test-only-jwt-secret-of-at-least-32-characters';

let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	for (const id of ['loc_1', 'loc_2', 'loc_3', 'loc_4', 'loc_5', 'loc_6', 'loc_7']) await insertUser(db, id);
	await db.prepare(`UPDATE users SET preferences = '{"theme":"dark","analyticsOptOut":true}' WHERE id = 'loc_2'`).run();
	await db.prepare(`UPDATE users SET preferences = NULL WHERE id = 'loc_3'`).run();
	// Rows made through drizzle before the default became an object hold the JSON string "{}".
	await db.prepare(`UPDATE users SET preferences = '"{}"' WHERE id = 'loc_4'`).run();
	await db.prepare(`UPDATE users SET preferences = 'not json' WHERE id = 'loc_5'`).run();
	await db.prepare(`UPDATE users SET preferences = '{"locale":"fr"}' WHERE id = 'loc_6'`).run();
	await db.prepare(`UPDATE users SET preferences = '{"locale":42}' WHERE id = 'loc_7'`).run();
});

const preferences = (id: string) => db.prepare('SELECT preferences FROM users WHERE id = ?').bind(id).first<{ preferences: string | null }>();

describe('the saved language', () => {
	it('is none until a language is chosen', async () => {
		expect(await new LocalePreferenceService(envWith(db)).locale('loc_1')).toBeNull();
	});

	it('round-trips each language', async () => {
		const service = new LocalePreferenceService(envWith(db));
		for (const locale of ['es', 'pt-BR', 'en'] as const) {
			await service.setLocale('loc_1', locale, new Date());
			expect(await service.locale('loc_1')).toBe(locale);
		}
	});

	it('keeps the other preferences, the analytics setting among them', async () => {
		const service = new LocalePreferenceService(envWith(db));
		await service.setLocale('loc_2', 'es', new Date());
		expect(JSON.parse((await preferences('loc_2'))?.preferences ?? '{}')).toEqual({ theme: 'dark', analyticsOptOut: true, locale: 'es' });
	});

	it('saves over an empty column, a stored JSON string and invalid JSON', async () => {
		const service = new LocalePreferenceService(envWith(db));
		for (const id of ['loc_3', 'loc_4', 'loc_5']) {
			expect(await service.locale(id)).toBeNull();
			await service.setLocale(id, 'pt-BR', new Date());
			expect(await service.locale(id)).toBe('pt-BR');
		}
		expect(JSON.parse((await preferences('loc_4'))?.preferences ?? '')).toEqual({ locale: 'pt-BR' });
	});

	it('reads a stored value that is not a language we speak as none', async () => {
		const service = new LocalePreferenceService(envWith(db));
		expect(await service.locale('loc_6')).toBeNull();
		expect(await service.locale('loc_7')).toBeNull();
	});

	it('is none for a user that does not exist, and saving for one changes nothing', async () => {
		const service = new LocalePreferenceService(envWith(db));
		expect(await service.locale('nobody')).toBeNull();
		await expect(service.setLocale('nobody', 'es', new Date())).resolves.toBeUndefined();
	});

	it('is stored as a JSON object for a user inserted through drizzle without preferences', async () => {
		await drizzle(db, { schema }).insert(schema.users).values({ id: 'loc_drizzle', email: 'loc_drizzle@example.test', displayName: 'loc_drizzle', provider: 'email', providerId: 'loc_drizzle' }).run();
		const service = new LocalePreferenceService(envWith(db));
		await service.setLocale('loc_drizzle', 'es', new Date());
		expect(JSON.parse((await preferences('loc_drizzle'))?.preferences ?? '')).toEqual({ locale: 'es' });
	});
});

describe('the session user', () => {
	it('carries the saved language, as the profile answers it', async () => {
		const service = new LocalePreferenceService(envWith(db));
		await service.setLocale('loc_1', 'pt-BR', new Date());
		const user = await new AuthService(envWith(db, { JWT_SECRET })).getUserForAuth('loc_1');
		expect(user?.locale).toBe('pt-BR');
		expect(mapUserResponse(user ?? { id: 'x', email: 'x' }).locale).toBe('pt-BR');
	});

	it('is what the profile endpoint answers, from the session user to the JSON', async () => {
		const env = envWith(db, { JWT_SECRET });
		await new LocalePreferenceService(env).setLocale('loc_1', 'es', new Date());
		const user = await new AuthService(env).getUserForAuth('loc_1');
		const response = await AuthController.getProfile(new Request('https://estori.app/api/auth/profile'), env, {} as ExecutionContext, { user, sessionId: 'session-1' } as unknown as RouteContext);
		expect((await response.json()).data.user.locale).toBe('es');
	});

	it('carries none for an account that never chose, and for stored values that cannot be read', async () => {
		const auth = new AuthService(envWith(db, { JWT_SECRET }));
		for (const id of ['loc_3', 'loc_4', 'loc_5', 'loc_6', 'loc_7']) {
			expect((await auth.getUserForAuth(id))?.locale, id).toBeNull();
		}
	});
});

describe('mapping a user to the answer', () => {
	const base = { id: 'u1', email: 'a@example.test' };

	it('reads the language from a full row, from an already mapped user, and from neither', () => {
		expect(mapUserResponse({ ...base, preferences: { locale: 'es' } }).locale).toBe('es');
		expect(mapUserResponse({ ...base, locale: 'pt-BR' }).locale).toBe('pt-BR');
		expect(mapUserResponse(base).locale).toBeNull();
	});

	it('answers none for anything that is not a language we speak', () => {
		expect(mapUserResponse({ ...base, preferences: { locale: 'fr' } }).locale).toBeNull();
		expect(mapUserResponse({ ...base, preferences: { locale: 7 } }).locale).toBeNull();
		expect(mapUserResponse({ ...base, preferences: null }).locale).toBeNull();
		expect(mapUserResponse({ ...base, preferences: '{"locale":"es"}' as unknown as Record<string, unknown> }).locale).toBeNull();
		expect(mapUserResponse({ ...base, locale: 'de' } as unknown as Parameters<typeof mapUserResponse>[0]).locale).toBeNull();
	});
});
