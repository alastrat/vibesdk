/** A store's languages for tests, without D1: settings, the ready languages and translations by source text. */

import type { Locale } from '../../../shared/i18n/locales';
import type { StoreTranslationSettings } from '../../../shared/types/store-translations';
import { normalizeText, textHash } from './extract';
import type { StoreLanguageContext } from './serve-context';

export interface FakeLanguageOptions {
	source: Locale;
	ready: Locale[];
	/** Extra flags, such as a language turned on that isn't ready yet. */
	targets?: StoreTranslationSettings['targets'];
	matchBrowser?: boolean;
	showSwitcher?: boolean;
	version?: number;
	/** Each language's translations, keyed by the source text as a page shows it. */
	translations?: Partial<Record<Locale, Record<string, string>>>;
	/** Loading a dictionary fails, as a D1 outage would. */
	failDictionary?: boolean;
}

export function fakeLanguageContext(options: FakeLanguageOptions): StoreLanguageContext {
	const targets: StoreTranslationSettings['targets'] = { ...options.targets };
	for (const locale of options.ready) targets[locale] = { enabled: true, ready: true };
	const entries = (locale: Locale): [string, string][] =>
		Object.entries(options.translations?.[locale] ?? {}).map(([source, text]) => [normalizeText(source), text]);
	return {
		appId: 'app_1',
		settings: {
			sourceLocale: options.source,
			targets,
			matchBrowser: options.matchBrowser ?? true,
			showSwitcher: options.showSwitcher ?? true,
			autoTranslate: true,
			version: options.version ?? 7,
		},
		ready: options.ready,
		async dictionary(locale) {
			if (options.failDictionary) throw new Error('D1 is unavailable');
			return new Map(await Promise.all(entries(locale).map(async ([source, text]): Promise<[string, string]> => [await textHash(source), text])));
		},
		async entries(locale) {
			if (options.failDictionary) throw new Error('D1 is unavailable');
			return entries(locale);
		},
	};
}
