/** Sign-up saves the language the visitor was using, on real SQL. */
import { beforeAll, describe, expect, it } from 'vitest';
import { TERMS_VERSION } from '../../../shared/types/legal';
import { envWith, migratedD1 } from '../test-support/real-d1';
import { registerSchema } from '../../api/controllers/auth/authSchemas';
import { AuthService } from './AuthService';

const JWT_SECRET = 'test-only-jwt-secret-of-at-least-32-characters';
const REQUEST = new Request('http://localhost/api/auth/register', { method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.9' } });
const SIGN_UP = { password: 'A-new-Passw0rd-for-Estori', name: 'New Person', acceptedTermsVersion: TERMS_VERSION };

let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
});

async function signUp(email: string, locale?: string) {
	const auth = new AuthService(envWith(db, { JWT_SECRET }));
	const parsed = registerSchema.parse({ ...SIGN_UP, email, ...(locale === undefined ? {} : { locale }) });
	return auth.register(parsed, REQUEST, null, 'https://estori.app');
}

const storedPreferences = async (email: string) => (await db.prepare('SELECT preferences FROM users WHERE email = ?').bind(email).first<{ preferences: string }>())?.preferences;

describe('sign-up', () => {
	it.each(['es', 'pt-BR', 'en'])('saves the language the visitor was using: %s', async (locale) => {
		const email = `signup-${locale.toLowerCase()}@example.test`;
		const result = await signUp(email, locale);
		expect(JSON.parse((await storedPreferences(email)) ?? '')).toEqual({ locale });
		expect(result.user.locale).toBe(locale);
	});

	it('saves none when the visitor sent none, leaving the account to follow the browser', async () => {
		const result = await signUp('signup-none@example.test');
		expect(JSON.parse((await storedPreferences('signup-none@example.test')) ?? '')).toEqual({});
		expect(result.user.locale).toBeNull();
	});

	it('saves none for a language we do not speak, and still signs the person up', async () => {
		const result = await signUp('signup-fr@example.test', 'fr');
		expect(result.accessToken).toBeTruthy();
		expect(JSON.parse((await storedPreferences('signup-fr@example.test')) ?? '')).toEqual({});
	});
});

describe('the sign-up request', () => {
	const base = { ...SIGN_UP, email: 'a@example.test' };

	it('keeps a language we speak', () => {
		expect(registerSchema.parse({ ...base, locale: 'pt-BR' }).locale).toBe('pt-BR');
	});

	it('drops anything else instead of refusing the sign-up', () => {
		for (const locale of ['fr', 'pt', '', 42, null, ['es'], { locale: 'es' }]) {
			expect(registerSchema.parse({ ...base, locale }).locale, JSON.stringify(locale)).toBeUndefined();
		}
		expect(registerSchema.parse(base).locale).toBeUndefined();
	});
});
