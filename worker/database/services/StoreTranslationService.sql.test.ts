/**
 * A store's texts, translations and language settings on real SQL: the defaults, the version that shoppers' caches key
 * on, machine and seller translations, and the reads the translation task, the editor and serving use.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { Locale } from '../../../shared/i18n/locales';
import type { StoreText } from '../../../shared/types/store-translations';
import { envWith, insertApp, insertUser, migratedD1 } from '../test-support/real-d1';
import { LocalePreferenceService } from './LocalePreferenceService';
import { StoreTranslationService } from './StoreTranslationService';

const NOW = 1_800_000_000_000;
let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	for (const id of ['seller_en', 'seller_es', 'seller_fr']) await insertUser(db, id);
	await new LocalePreferenceService(envWith(db)).setLocale('seller_es', 'es', new Date(NOW));
	await db.prepare(`UPDATE users SET preferences = '{"locale":"fr"}' WHERE id = 'seller_fr'`).run();
	for (const [id, userId] of [['app_en', 'seller_en'], ['app_es', 'seller_es'], ['app_fr', 'seller_fr'], ['app_1', 'seller_en']]) await insertApp(db, { id, userId });
});

const service = () => new StoreTranslationService(envWith(db));

const text = (name: string, kind: StoreText['kind'] = 'page'): StoreText => ({ hash: `hash-${name}`, text: `Text ${name}`, kind });
const machine = (name: string, translated = `Texto ${name}`) => ({ hash: `hash-${name}`, source: `Text ${name}`, text: translated });

async function rowOf(locale: Locale, name: string) {
	const rows = (await service().listRows('app_1', locale, { limit: 100 })).rows;
	const row = rows.find((candidate) => candidate.hash === `hash-${name}`);
	if (!row) throw new Error(`No row ${name}`);
	return row;
}

const versionOf = async (appId = 'app_1') => (await service().settingsOf(appId)).version;

describe('store translation settings', () => {
	it('settingsOf gives defaults with the owner\'s locale as source', async () => {
		expect(await service().settingsOf('app_en')).toEqual({ sourceLocale: 'en', targets: {}, matchBrowser: true, showSwitcher: true, autoTranslate: true, version: 1 });
		expect(await service().settingsOf('app_es')).toMatchObject({ sourceLocale: 'es', targets: {}, version: 1 });
		// A saved language Estori doesn't speak falls back to English.
		expect(await service().settingsOf('app_fr')).toMatchObject({ sourceLocale: 'en' });
		// Reading the defaults stores nothing.
		const stored = await db.prepare('SELECT count(*) AS n FROM store_translation_settings').first<{ n: number }>();
		expect(stored?.n).toBe(0);
	});

	it('saveSettings bumps version', async () => {
		const saved = await service().saveSettings('app_es', { matchBrowser: false, targets: { en: { enabled: true } } }, NOW);
		expect(saved).toEqual({ sourceLocale: 'es', targets: { en: { enabled: true, ready: false } }, matchBrowser: false, showSwitcher: true, autoTranslate: true, version: 2 });

		const again = await service().saveSettings('app_es', { showSwitcher: false, autoTranslate: false, sourceLocale: 'pt-BR' }, NOW + 1);
		expect(again).toEqual({ sourceLocale: 'pt-BR', targets: { en: { enabled: true, ready: false } }, matchBrowser: false, showSwitcher: false, autoTranslate: false, version: 3 });
		expect(await service().settingsOf('app_es')).toEqual(again);
	});

	it('saveSettings changes one language without touching the others or what is ready', async () => {
		await service().saveSettings('app_en', { targets: { es: { enabled: true }, 'pt-BR': { enabled: true } } }, NOW);
		await service().markReady('app_en', 'es', NOW);
		const saved = await service().saveSettings('app_en', { targets: { 'pt-BR': { enabled: false } } }, NOW);
		expect(saved.targets).toEqual({ es: { enabled: true, ready: true }, 'pt-BR': { enabled: false, ready: false } });
	});

	it('markReady turns a language on when it was never set, and keeps a language the seller turned off', async () => {
		const first = await service().markReady('app_1', 'es', NOW);
		expect(first).toMatchObject({ targets: { es: { enabled: true, ready: true } }, version: 2 });

		await service().saveSettings('app_1', { targets: { 'pt-BR': { enabled: false } } }, NOW);
		const second = await service().markReady('app_1', 'pt-BR', NOW);
		expect(second).toMatchObject({ targets: { es: { enabled: true, ready: true }, 'pt-BR': { enabled: false, ready: true } }, version: 4 });
	});
});

describe('store texts', () => {
	it('replaceTexts replaces the store\'s texts, keeps its translations, and does not bump the version', async () => {
		await service().replaceTexts('app_1', [text('a'), text('b')], NOW);
		await service().upsertMachine('app_1', 'es', [machine('a'), machine('b')], NOW);
		const before = await versionOf();

		await service().replaceTexts('app_1', [text('b'), text('c')], NOW + 1);
		expect((await service().listRows('app_1', 'es', { limit: 10 })).rows.map((row) => row.hash)).toEqual(['hash-b', 'hash-c']);
		// The text that went away keeps its translation for when it returns, and is served meanwhile.
		expect((await service().dictionary('app_1', 'es')).get('hash-a')).toBe('Texto a');
		expect(await versionOf()).toBe(before);
	});

	it('replaceTexts saves when the texts were read, and stores any number of texts under the bound-parameter limit', async () => {
		expect(await service().extractedAt('app_1')).toBeNull();
		const many = Array.from({ length: 5_000 }, (_, index) => text(`n${index}`, index % 3 === 0 ? 'script' : 'page'));
		await service().replaceTexts('app_1', many, NOW);
		expect(await service().extractedAt('app_1')).toBe(NOW);
		expect((await service().counts('app_1')).es.total).toBe(5_000);

		await service().replaceTexts('app_1', [], NOW + 5);
		expect((await service().counts('app_1')).es.total).toBe(0);
		expect(await service().extractedAt('app_1')).toBe(NOW + 5);
	});

	it('missingTexts lists only untranslated texts for the locale, oldest first', async () => {
		await service().replaceTexts('app_1', [text('a'), text('b'), text('c'), text('d')], NOW);
		await db.prepare(`INSERT INTO store_texts (app_id, source_hash, source_text, kind, seen_at) VALUES ('app_1', 'hash-old', 'Text old', 'page', ?)`).bind(NOW - 1_000).run();
		await service().upsertMachine('app_1', 'es', [machine('b')], NOW);
		await service().setSellerText('app_1', 'es', 'hash-c', 'Mi texto', NOW);

		const spanish = await service().missingTexts('app_1', 'es', 10);
		// The oldest first, then the order the texts were read in.
		expect(spanish).toEqual([
			{ hash: 'hash-old', text: 'Text old', kind: 'page' },
			{ hash: 'hash-a', text: 'Text a', kind: 'page' },
			{ hash: 'hash-d', text: 'Text d', kind: 'page' },
		]);
		expect((await service().missingTexts('app_1', 'es', 2)).map((row) => row.hash)).toEqual(['hash-old', 'hash-a']);
		// Another language has its own translations.
		expect((await service().missingTexts('app_1', 'pt-BR', 10)).map((row) => row.hash)).toEqual(['hash-old', 'hash-a', 'hash-b', 'hash-c', 'hash-d']);
		expect(await service().missingTexts('app_other', 'es', 10)).toEqual([]);
	});

	it('counts per locale', async () => {
		await service().replaceTexts('app_1', [text('a'), text('b'), text('c')], NOW);
		await service().upsertMachine('app_1', 'es', [machine('a'), machine('b')], NOW);
		await service().setSellerText('app_1', 'es', 'hash-b', 'Mi texto', NOW);
		await service().upsertMachine('app_1', 'pt-BR', [machine('a', 'Texto a')], NOW);
		// A translation of a text the store no longer shows is not counted.
		await service().upsertMachine('app_1', 'es', [{ hash: 'hash-gone', source: 'Text gone', text: 'Texto gone' }], NOW);

		expect(await service().counts('app_1')).toEqual({
			en: { total: 3, translated: 0, edited: 0 },
			es: { total: 3, translated: 2, edited: 1 },
			'pt-BR': { total: 3, translated: 1, edited: 0 },
		});
		expect((await service().counts('app_en')).es).toEqual({ total: 0, translated: 0, edited: 0 });
	});

	it('listRows filters by query in source or translation', async () => {
		await service().replaceTexts('app_1', [text('apple'), text('banana'), text('cherry')], NOW);
		await service().upsertMachine('app_1', 'es', [machine('apple', 'Manzana roja'), machine('banana', 'Plátano')], NOW);

		const list = (query: string | undefined) => service().listRows('app_1', 'es', { query, limit: 10 }).then((page) => page.rows.map((row) => row.hash));
		expect(await list(undefined)).toEqual(['hash-apple', 'hash-banana', 'hash-cherry']);
		expect(await list('')).toEqual(['hash-apple', 'hash-banana', 'hash-cherry']);
		// In the source text.
		expect(await list('cherry')).toEqual(['hash-cherry']);
		// In the translation, whatever the case.
		expect(await list('manzana')).toEqual(['hash-apple']);
		expect(await list('Plátano')).toEqual(['hash-banana']);
		// Wildcards are plain characters.
		expect(await list('%')).toEqual([]);
		expect(await list('Text _')).toEqual([]);
		expect(await list('nothing like it')).toEqual([]);
	});

	it('listRows gives every text with its translation, and pages by cursor', async () => {
		await service().replaceTexts('app_1', [text('a'), text('b'), text('c'), text('d'), text('e')], NOW);
		await service().upsertMachine('app_1', 'es', [machine('b')], NOW);
		await service().setSellerText('app_1', 'es', 'hash-b', 'Mi texto', NOW);

		const first = await service().listRows('app_1', 'es', { limit: 2 });
		expect(first.rows).toEqual([
			{ hash: 'hash-a', source: 'Text a', text: null, origin: null, machineText: null },
			{ hash: 'hash-b', source: 'Text b', text: 'Mi texto', origin: 'seller', machineText: 'Texto b' },
		]);
		expect(first.nextCursor).not.toBeNull();

		const second = await service().listRows('app_1', 'es', { limit: 2, cursor: first.nextCursor ?? undefined });
		expect(second.rows.map((row) => row.hash)).toEqual(['hash-c', 'hash-d']);
		const third = await service().listRows('app_1', 'es', { limit: 2, cursor: second.nextCursor ?? undefined });
		expect(third.rows.map((row) => row.hash)).toEqual(['hash-e']);
		expect(third.nextCursor).toBeNull();
	});
});

describe('store translations', () => {
	it('upsertMachine keeps a seller edit and stores machine_text', async () => {
		await service().replaceTexts('app_1', [text('a'), text('b')], NOW);
		const first = await versionOf();
		await service().upsertMachine('app_1', 'es', [machine('a'), machine('b')], NOW);
		expect(await versionOf()).toBe(first + 1);
		expect(await rowOf('es', 'a')).toMatchObject({ text: 'Texto a', origin: 'machine', machineText: 'Texto a' });

		expect(await service().setSellerText('app_1', 'es', 'hash-a', 'Mi propio texto', NOW)).toBe(true);
		expect(await rowOf('es', 'a')).toMatchObject({ text: 'Mi propio texto', origin: 'seller', machineText: 'Texto a' });
		expect(await versionOf()).toBe(first + 2);

		await service().upsertMachine('app_1', 'es', [machine('a', 'Texto nuevo a'), machine('b', 'Texto nuevo b')], NOW + 1);
		// The seller's words stay; the machine's latest is what they can go back to.
		expect(await rowOf('es', 'a')).toMatchObject({ text: 'Mi propio texto', origin: 'seller', machineText: 'Texto nuevo a' });
		expect(await rowOf('es', 'b')).toMatchObject({ text: 'Texto nuevo b', origin: 'machine', machineText: 'Texto nuevo b' });
		expect(await versionOf()).toBe(first + 3);

		// Each language is its own.
		expect((await rowOf('pt-BR', 'a')).text).toBeNull();
	});

	it('upsertMachine stores a whole batch, and an empty one changes nothing', async () => {
		const names = Array.from({ length: 40 }, (_, index) => `m${index}`);
		await service().replaceTexts('app_1', names.map((name) => text(name)), NOW);
		const before = await versionOf();
		await service().upsertMachine('app_1', 'pt-BR', names.map((name) => machine(name)), NOW);
		expect((await service().counts('app_1'))['pt-BR']).toEqual({ total: 40, translated: 40, edited: 0 });
		expect(await versionOf()).toBe(before + 1);

		await service().upsertMachine('app_1', 'pt-BR', [], NOW);
		expect(await versionOf()).toBe(before + 1);
	});

	it('setSellerText writes the seller\'s words for a text the store shows, and refuses one it does not', async () => {
		await service().replaceTexts('app_1', [text('a')], NOW);
		const before = await versionOf();

		// No machine translation yet: the edit stands alone and there is nothing to go back to.
		expect(await service().setSellerText('app_1', 'es', 'hash-a', 'Hola', NOW)).toBe(true);
		expect(await rowOf('es', 'a')).toEqual({ hash: 'hash-a', source: 'Text a', text: 'Hola', origin: 'seller', machineText: null });
		expect(await versionOf()).toBe(before + 1);

		// A hash no text of the store has.
		expect(await service().setSellerText('app_1', 'es', 'hash-unknown', 'Hola', NOW)).toBe(false);
		expect(await versionOf()).toBe(before + 1);
	});

	it('setSellerText edits a translation whose text has since gone', async () => {
		await service().replaceTexts('app_1', [text('a')], NOW);
		await service().upsertMachine('app_1', 'es', [machine('a')], NOW);
		await service().replaceTexts('app_1', [text('b')], NOW + 1);
		expect(await service().setSellerText('app_1', 'es', 'hash-a', 'Hola otra vez', NOW + 2)).toBe(true);
		expect((await service().dictionary('app_1', 'es')).get('hash-a')).toBe('Hola otra vez');
	});

	it('revertToMachine restores the machine text', async () => {
		await service().replaceTexts('app_1', [text('a'), text('b')], NOW);
		await service().upsertMachine('app_1', 'es', [machine('a')], NOW);
		await service().setSellerText('app_1', 'es', 'hash-a', 'Mi texto', NOW);
		await service().setSellerText('app_1', 'es', 'hash-b', 'Solo mio', NOW);
		const before = await versionOf();

		expect(await service().revertToMachine('app_1', 'es', 'hash-a', NOW + 1)).toBe(true);
		expect(await rowOf('es', 'a')).toMatchObject({ text: 'Texto a', origin: 'machine', machineText: 'Texto a' });
		expect(await versionOf()).toBe(before + 1);

		// Nothing to go back to: a machine text already, a seller text the machine never translated, or no text at all.
		expect(await service().revertToMachine('app_1', 'es', 'hash-a', NOW + 2)).toBe(false);
		expect(await service().revertToMachine('app_1', 'es', 'hash-b', NOW + 2)).toBe(false);
		expect(await service().revertToMachine('app_1', 'es', 'hash-nothing', NOW + 2)).toBe(false);
		expect(await rowOf('es', 'b')).toMatchObject({ text: 'Solo mio', origin: 'seller' });
		expect(await versionOf()).toBe(before + 1);
	});

	it('dictionary maps source hashes to the language\'s translations', async () => {
		await service().replaceTexts('app_1', [text('a'), text('b')], NOW);
		await service().upsertMachine('app_1', 'es', [machine('a'), machine('b')], NOW);
		await service().upsertMachine('app_1', 'pt-BR', [machine('a', 'Texto pt a')], NOW);
		await service().setSellerText('app_1', 'es', 'hash-b', 'Mi b', NOW);

		expect(await service().dictionary('app_1', 'es')).toEqual(new Map([['hash-a', 'Texto a'], ['hash-b', 'Mi b']]));
		expect(await service().dictionary('app_1', 'pt-BR')).toEqual(new Map([['hash-a', 'Texto pt a']]));
		expect(await service().dictionary('app_1', 'en')).toEqual(new Map());
		expect(await service().dictionary('app_other', 'es')).toEqual(new Map());
	});
});
