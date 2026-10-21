import { beforeAll, describe, expect, it } from 'vitest';
import { msg } from '../../shared/i18n/translate';
import { STORE_TRANSLATIONS_PAUSED_MESSAGE } from '../../shared/types/pauses';
import { LocalePreferenceService } from '../database/services/LocalePreferenceService';
import { envWith, insertUser, migratedD1 } from '../database/test-support/real-d1';
import { localeOfUser, translateFor, translateForUser } from './server-translate';

let env: Env;

beforeAll(async () => {
	const db = await migratedD1();
	env = envWith(db);
	for (const id of ['seller_none', 'seller_es', 'seller_pt', 'seller_fr']) await insertUser(db, id);
	await new LocalePreferenceService(env).setLocale('seller_es', 'es', new Date());
	await new LocalePreferenceService(env).setLocale('seller_pt', 'pt-BR', new Date());
	await db.prepare(`UPDATE users SET preferences = '{"locale":"fr"}' WHERE id = 'seller_fr'`).run();
});

describe('the server speaking the seller\'s language', () => {
	it('translates a marked message with the catalog of the language, and fills in its values', () => {
		expect(translateFor('en', STORE_TRANSLATIONS_PAUSED_MESSAGE)).toBe('Store translations are paused for a few minutes. Stores already translated keep working.');
		expect(translateFor('es', STORE_TRANSLATIONS_PAUSED_MESSAGE)).not.toBe(STORE_TRANSLATIONS_PAUSED_MESSAGE);
		expect(translateFor('pt-BR', STORE_TRANSLATIONS_PAUSED_MESSAGE)).not.toBe(STORE_TRANSLATIONS_PAUSED_MESSAGE);
		expect(translateFor('es', msg('{language} is a made-up message that no catalog has'), { language: 'Español' })).toBe('Español is a made-up message that no catalog has');
	});

	it("uses the user's saved language, and English when they never chose one or chose one Estori does not speak", async () => {
		expect(await localeOfUser(env, 'seller_es')).toBe('es');
		expect(await localeOfUser(env, 'seller_pt')).toBe('pt-BR');
		expect(await localeOfUser(env, 'seller_none')).toBe('en');
		expect(await localeOfUser(env, 'seller_fr')).toBe('en');
		expect(await localeOfUser(env, 'nobody')).toBe('en');
		expect(await translateForUser(env, 'seller_es', STORE_TRANSLATIONS_PAUSED_MESSAGE)).toBe(translateFor('es', STORE_TRANSLATIONS_PAUSED_MESSAGE));
		expect(await translateForUser(env, 'seller_none', STORE_TRANSLATIONS_PAUSED_MESSAGE)).toBe(STORE_TRANSLATIONS_PAUSED_MESSAGE);
	});
});
