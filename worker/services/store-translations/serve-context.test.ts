/** A store's languages, cached per isolate: settings for 30 seconds, each language's translations per version. */

import { describe, expect, it } from 'vitest';
import type { Locale } from '../../../shared/i18n/locales';
import type { StoreTranslationSettings } from '../../../shared/types/store-translations';
import { textHash } from './extract';
import { createStoreLanguageLoader, type StoreLanguageSource } from './serve-context';

function settings(overrides: Partial<StoreTranslationSettings> = {}): StoreTranslationSettings {
	return { sourceLocale: 'en', targets: { es: { enabled: true, ready: true } }, matchBrowser: true, showSwitcher: true, autoTranslate: true, version: 3, ...overrides };
}

/** A source that counts its reads; `current` is what D1 would answer now. */
function countingSource(current: { settings: StoreTranslationSettings; failNext?: boolean }) {
	const reads = { settings: 0, translations: [] as string[] };
	const source: StoreLanguageSource = {
		async settingsOf() {
			reads.settings++;
			if (current.failNext) {
				current.failNext = false;
				throw new Error('D1 is unavailable');
			}
			return current.settings;
		},
		async translationsOf(_appId: string, locale: Locale) {
			reads.translations.push(`${locale}@${current.settings.version}`);
			return [{ hash: await textHash('Fresh tea'), source: 'Fresh tea', text: `Fresh tea in ${locale} v${current.settings.version}` }];
		},
	};
	return { source, reads };
}

describe('loadStoreLanguageContext', () => {
	it("reuses a store's settings for 30 seconds", async () => {
		let now = 1_000;
		const load = createStoreLanguageLoader(() => now);
		const current = { settings: settings() };
		const { source, reads } = countingSource(current);
		await load(source, 'app_1');
		now += 29_999;
		await load(source, 'app_1');
		expect(reads.settings).toBe(1);
		await load(source, 'app_2');
		expect(reads.settings).toBe(2);
		now += 1;
		await load(source, 'app_1');
		expect(reads.settings).toBe(3);
	});

	it('only offers languages the seller turned on whose first translation finished, never the source', async () => {
		const load = createStoreLanguageLoader(() => 0);
		const targets: StoreTranslationSettings['targets'] = { en: { enabled: true, ready: true }, es: { enabled: true, ready: false }, 'pt-BR': { enabled: false, ready: true } };
		const { source } = countingSource({ settings: settings({ sourceLocale: 'en', targets }) });
		expect((await load(source, 'app_1')).ready).toEqual([]);
		const { source: other } = countingSource({ settings: settings({ sourceLocale: 'es', targets: { en: { enabled: true, ready: true }, 'pt-BR': { enabled: true, ready: true } } }) });
		expect((await load(other, 'app_2')).ready).toEqual(['en', 'pt-BR']);
	});

	it("loads each language's translations once per version, by hash and as pairs", async () => {
		let now = 0;
		const load = createStoreLanguageLoader(() => now);
		const current = { settings: settings() };
		const { source, reads } = countingSource(current);
		const ctx = await load(source, 'app_1');
		expect(await ctx.dictionary('es')).toEqual(new Map([[await textHash('Fresh tea'), 'Fresh tea in es v3']]));
		expect(await ctx.entries('es')).toEqual([['Fresh tea', 'Fresh tea in es v3']]);
		expect(await (await load(source, 'app_1')).dictionary('es')).toBeInstanceOf(Map);
		expect(reads.translations).toEqual(['es@3']);

		// The seller's next edit bumps the version; once the settings are read again, so are the translations.
		current.settings = settings({ version: 4 });
		now += 30_000;
		expect(await (await load(source, 'app_1')).entries('es')).toEqual([['Fresh tea', 'Fresh tea in es v4']]);
		expect(reads.translations).toEqual(['es@3', 'es@4']);
	});

	it('tries again after a failed read instead of keeping the failure', async () => {
		const load = createStoreLanguageLoader(() => 0);
		const current = { settings: settings(), failNext: true };
		const { source, reads } = countingSource(current);
		await expect(load(source, 'app_1')).rejects.toThrow('D1 is unavailable');
		expect((await load(source, 'app_1')).ready).toEqual(['es']);
		expect(reads.settings).toBe(2);
	});
});
