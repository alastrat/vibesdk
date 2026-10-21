/** The saved-language API on real SQL. */
import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertUser, migratedD1 } from '../../../database/test-support/real-d1';
import { UserController } from './controller';
import type { RouteContext } from '../../types/route-context';

let db: D1Database;
const context = { user: { id: 'loc_api', email: 'loc_api@example.test' } } as unknown as RouteContext;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'loc_api');
});

function put(body: unknown, signedIn = true) {
	const request = new Request('https://estori.app/api/user/locale', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
	return UserController.setLocale(request, envWith(db), {} as ExecutionContext, signedIn ? context : ({} as RouteContext));
}

const saved = async () => (await db.prepare(`SELECT json_extract(preferences, '$.locale') AS locale FROM users WHERE id = 'loc_api'`).first<{ locale: string | null }>())?.locale;

describe('PUT /api/user/locale', () => {
	it('saves each language and answers it', async () => {
		for (const locale of ['es', 'pt-BR', 'en']) {
			const response = await put({ locale });
			expect(response.status).toBe(200);
			expect((await response.json()).data).toEqual({ locale });
			expect(await saved()).toBe(locale);
		}
	});

	it('answers 400 for a language we do not speak, and saves nothing', async () => {
		await put({ locale: 'es' });
		const response = await put({ locale: 'fr' });
		expect(response.status).toBe(400);
		expect((await response.json()).error.message).toBe("That language isn't available.");
		expect(await saved()).toBe('es');
	});

	it('answers 400 for a body with no language, a language that is not text, and a body that is not JSON', async () => {
		expect((await put({})).status).toBe(400);
		expect((await put({ locale: 3 })).status).toBe(400);
		expect((await put({ locale: null })).status).toBe(400);
		expect((await put('not json')).status).toBe(400);
		expect((await put(JSON.stringify(['es']))).status).toBe(400);
	});

	it('refuses someone who is not signed in', async () => {
		expect((await put({ locale: 'es' }, false)).status).toBe(401);
	});
});
