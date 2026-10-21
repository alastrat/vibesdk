/** A store's languages, cached per isolate: settings for 30 seconds, each language's translations per version. */

import { describe, expect, it } from 'vitest';
import type { Locale } from '../../../shared/i18n/locales';
import type { StoreTranslationSettings } from '../../../shared/types/store-translations';
import { textHash } from './extract';
import { createStoreLanguageLoader, type StoreLanguageSource } from './serve-context';

function settings(overrides: Partial<StoreTranslationSettings> = {}): StoreTranslationSettings {
	return { sourceLocale: 'en', targets: { es: { enabled: true, ready: true } }, matchBrowser: true, showSwitcher: true, autoTranslate: true, version: 3, ...overrides };
}

/** A source that counts its reads; `stored` is the store's saved settings row, or null when it has none. */
function countingSource(current: { stored: StoreTranslationSettings | null; failNext?: boolean }) {
	const reads = { stored: 0, translations: [] as string[], scripts: 0 };
	const source: StoreLanguageSource = {
		async storedSettings() {
			reads.stored++;
			if (current.failNext) {
				current.failNext = false;
				throw new Error('D1 is unavailable');
			}
			return current.stored;
		},
		async translationsOf(_appId: string, locale: Locale) {
			const version = current.stored?.version ?? 0;
			reads.translations.push(`${locale}@${version}`);
			return [{ hash: await textHash('Fresh tea'), source: 'Fresh tea', text: `Fresh tea in ${locale} v${version}` }];
		},
		async scriptTranslationsOf() {
			reads.scripts++;
			return [{ hash: await textHash('Add to cart'), source: 'Add to cart', text: 'Agregar al carrito' }];
		},
	};
	return { source, reads };
}

describe('the store language loader', () => {
	it('evicts dictionaries by their total characters, including a single dictionary past the budget', async () => {
		const load = createStoreLanguageLoader(() => 0, 200);
		const { source, reads } = countingSource({ stored: settings() });
		for (const app of ['a', 'b', 'c']) await (await load.context(source, app)).dictionary('es');
		await (await load.context(source, 'a')).dictionary('es');
		expect(reads.translations).toHaveLength(4);
		const tiny = createStoreLanguageLoader(() => 0, 1);
		await (await tiny.context(source, 'a')).dictionary('es');
		await (await tiny.context(source, 'a')).dictionary('es');
		expect(reads.translations).toHaveLength(6);
	});

	it('reloads dictionaries after re-extraction without a settings version change', async () => {
		let now = 0;
		const load = createStoreLanguageLoader(() => now);
		const current = { stored: { ...settings(), extractedAt: 100 } };
		const { source, reads } = countingSource(current);
		await (await load.context(source, 'app_1')).dictionary('es');
		current.stored.extractedAt = 200;
		now = 30_000;
		await (await load.context(source, 'app_1')).dictionary('es');
		expect(reads.translations).toHaveLength(2);
	});
	it("reuses a store's settings for 30 seconds", async () => {
		let now = 1_000;
		const load = createStoreLanguageLoader(() => now);
		const { source, reads } = countingSource({ stored: settings() });
		await load.serving(source, 'app_1');
		now += 29_999;
		await load.serving(source, 'app_1');
		await load.context(source, 'app_1');
		expect(reads.stored).toBe(1);
		await load.serving(source, 'app_2');
		expect(reads.stored).toBe(2);
		now += 1;
		await load.serving(source, 'app_1');
		expect(reads.stored).toBe(3);
	});

	it('serves nothing for a store without settings, after one read, and keeps it in English for Estori\'s own pages', async () => {
		let now = 0;
		const load = createStoreLanguageLoader(() => now);
		const { source, reads } = countingSource({ stored: null });
		expect(await load.serving(source, 'app_1')).toBeNull();
		expect(await load.serving(source, 'app_1')).toBeNull();
		// Never the owner's own language: an English store stays English for sellers who use Estori in Spanish.
		const ctx = await load.context(source, 'app_1');
		expect(ctx.settings.sourceLocale).toBe('en');
		expect(ctx.ready).toEqual([]);
		expect(reads.stored).toBe(1);
		now += 30_000;
		await load.context(source, 'app_1');
		expect(reads.stored).toBe(2);
	});

	it('only offers languages the seller turned on whose first translation finished, never the source', async () => {
		const load = createStoreLanguageLoader(() => 0);
		const targets: StoreTranslationSettings['targets'] = { en: { enabled: true, ready: true }, es: { enabled: true, ready: false }, 'pt-BR': { enabled: false, ready: true } };
		const { source } = countingSource({ stored: settings({ sourceLocale: 'en', targets }) });
		expect(await load.serving(source, 'app_1')).toBeNull();
		expect((await load.context(source, 'app_1')).ready).toEqual([]);
		const { source: other } = countingSource({ stored: settings({ sourceLocale: 'es', targets: { en: { enabled: true, ready: true }, 'pt-BR': { enabled: true, ready: true } } }) });
		expect((await load.serving(other, 'app_2'))?.ready).toEqual(['en', 'pt-BR']);
	});

	it("loads each language's translations once per version, by hash and by text", async () => {
		let now = 0;
		const load = createStoreLanguageLoader(() => now);
		const current = { stored: settings() };
		const { source, reads } = countingSource(current);
		const ctx = await load.context(source, 'app_1');
		expect(await ctx.dictionary('es')).toEqual(new Map([[await textHash('Fresh tea'), 'Fresh tea in es v3']]));
		expect(await ctx.texts('es')).toEqual(new Map([['Fresh tea', 'Fresh tea in es v3']]));
		expect(await (await load.context(source, 'app_1')).texts('es')).toBeInstanceOf(Map);
		expect(reads.translations).toEqual(['es@3']);

		// The seller's next edit bumps the version; once the settings are read again, so are the translations.
		current.stored = settings({ version: 4 });
		now += 30_000;
		expect(await (await load.context(source, 'app_1')).texts('es')).toEqual(new Map([['Fresh tea', 'Fresh tea in es v4']]));
		expect(reads.translations).toEqual(['es@3', 'es@4']);

		// The overlay's texts are read on their own, only when the overlay is asked for.
		expect(reads.scripts).toBe(0);
		expect(await ctx.scriptEntries('es')).toEqual([['Add to cart', 'Agregar al carrito']]);
		expect(reads.scripts).toBe(1);
	});

	it('tries again after a failed read instead of keeping the failure', async () => {
		const load = createStoreLanguageLoader(() => 0);
		const { source, reads } = countingSource({ stored: settings(), failNext: true });
		await expect(load.serving(source, 'app_1')).rejects.toThrow('D1 is unavailable');
		expect((await load.serving(source, 'app_1'))?.ready).toEqual(['es']);
		expect(reads.stored).toBe(2);
	});
});
