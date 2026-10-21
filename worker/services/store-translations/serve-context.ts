/**
 * A store's languages as serving needs them, cached per isolate like store hosts: the saved settings for 30 seconds,
 * and each language's translations until the settings' version changes. A store that never saved settings costs one
 * read per 30 seconds, has nothing to serve and is in English, as it was before it had languages: serving never reads
 * the owner's own language. `serveStorePage` puts a store's pages through them.
 */

import { DEFAULT_LOCALE, LOCALES, type Locale } from '../../../shared/i18n/locales';
import type { StoreTranslationSettings } from '../../../shared/types/store-translations';
import { StoreTranslationService, unsavedSettings, type StoreTranslationEntry } from '../../database/services/StoreTranslationService';
import { createLogger } from '../../logger';
import { languageCookie, resolveShopperLanguage } from './language';
import { isStorePage, translateStoreHtml } from './rewrite';

const logger = createLogger('StoreLanguages');

/** How long a store's settings are reused, so a store page doesn't read D1 on every request. */
export const STORE_LANGUAGE_CACHE_MS = 30_000;
const SETTINGS_CACHE_MAX_ENTRIES = 1_000;
/** Translations are the larger part, so fewer stores' languages are kept. */
const TRANSLATIONS_CACHE_MAX_ENTRIES = 50;

export interface StoreLanguageContext {
	appId: string;
	settings: StoreTranslationSettings;
	/** Languages the seller turned on whose first translation finished, never the source, in Estori's order. */
	ready: Locale[];
	/** A language's translations by the hash of their normalized source text. */
	dictionary(locale: Locale): Promise<Map<string, string>>;
	/** The same translations by normalized source text, so a page's texts are looked up without hashing. */
	texts(locale: Locale): Promise<ReadonlyMap<string, string>>;
	/** `[normalized source text, translation]` pairs of the texts the store's scripts show now, for the overlay script. */
	scriptEntries(locale: Locale): Promise<[string, string][]>;
}

/** Where a store's languages are read from: D1, through StoreTranslationService. */
export interface StoreLanguageSource {
	storedSettings(appId: string): Promise<StoreTranslationSettings | null>;
	translationsOf(appId: string, locale: Locale): Promise<StoreTranslationEntry[]>;
	scriptTranslationsOf(appId: string, locale: Locale): Promise<StoreTranslationEntry[]>;
}

interface LoadedTranslations {
	byHash: Map<string, string>;
	byText: ReadonlyMap<string, string>;
}

interface CachedSettings {
	stored: Promise<StoreTranslationSettings | null>;
	expiresAt: number;
}

function readyLanguages(settings: StoreTranslationSettings): Locale[] {
	return LOCALES.filter((locale) => {
		const target = settings.targets[locale];
		return locale !== settings.sourceLocale && target?.enabled === true && target.ready;
	});
}

/** Keeps the newest `max` entries; the least recently stored goes first. */
function remember<V>(cache: Map<string, V>, key: string, value: V, max: number): void {
	cache.delete(key);
	cache.set(key, value);
	if (cache.size > max) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
}

/** Loaders with their own caches; the source is per call, so each request reads D1 through its own environment. */
export function createStoreLanguageLoader(nowMs: () => number = Date.now) {
	const settingsCache = new Map<string, CachedSettings>();
	const translationsCache = new Map<string, { version: number; loaded: Promise<LoadedTranslations> }>();

	const cachedSettings = (source: StoreLanguageSource, appId: string): CachedSettings => {
		const cached = settingsCache.get(appId);
		if (cached && cached.expiresAt > nowMs()) return cached;
		const entry: CachedSettings = { stored: source.storedSettings(appId), expiresAt: nowMs() + STORE_LANGUAGE_CACHE_MS };
		remember(settingsCache, appId, entry, SETTINGS_CACHE_MAX_ENTRIES);
		// A failed read is not kept, so the next request reads again.
		entry.stored.catch(() => settingsCache.get(appId) === entry && settingsCache.delete(appId));
		return entry;
	};

	const translationsFor = (source: StoreLanguageSource, appId: string, locale: Locale, version: number): Promise<LoadedTranslations> => {
		const key = `${appId}\n${locale}`;
		const cached = translationsCache.get(key);
		if (cached?.version === version) return cached.loaded;
		const loaded = source.translationsOf(appId, locale).then((rows) => ({
			byHash: new Map(rows.map((row) => [row.hash, row.text])),
			byText: new Map(rows.map((row) => [row.source, row.text])),
		}));
		const entry = { version, loaded };
		remember(translationsCache, key, entry, TRANSLATIONS_CACHE_MAX_ENTRIES);
		loaded.catch(() => translationsCache.get(key) === entry && translationsCache.delete(key));
		return loaded;
	};

	const contextOf = (source: StoreLanguageSource, appId: string, settings: StoreTranslationSettings): StoreLanguageContext => ({
		appId,
		settings,
		ready: readyLanguages(settings),
		dictionary: async (locale) => (await translationsFor(source, appId, locale, settings.version)).byHash,
		texts: async (locale) => (await translationsFor(source, appId, locale, settings.version)).byText,
		scriptEntries: async (locale) => (await source.scriptTranslationsOf(appId, locale)).map((row): [string, string] => [row.source, row.text]),
	});

	return {
		/** The store's languages when it has one ready to serve; null otherwise, which is the common case. */
		async serving(source: StoreLanguageSource, appId: string): Promise<StoreLanguageContext | null> {
			const stored = await cachedSettings(source, appId).stored;
			const ctx = stored ? contextOf(source, appId, stored) : null;
			return ctx && ctx.ready.length > 0 ? ctx : null;
		},
		/** The store's languages for a page that needs its source language even without any other: English without settings. */
		async context(source: StoreLanguageSource, appId: string): Promise<StoreLanguageContext> {
			const stored = await cachedSettings(source, appId).stored;
			return contextOf(source, appId, stored ?? unsavedSettings(DEFAULT_LOCALE));
		},
	};
}

const sharedLoader = createStoreLanguageLoader();

/** The store's languages when it has a ready one to serve, cached per isolate; null for a store that serves only its own. */
export async function loadServingLanguages(env: Env, appId: string): Promise<StoreLanguageContext | null> {
	return sharedLoader.serving(new StoreTranslationService(env), appId);
}

/** The store's languages, cached per isolate; a store that saved no settings is in English, with no other language. */
export async function loadStoreLanguageContext(env: Env, appId: string): Promise<StoreLanguageContext> {
	return sharedLoader.context(new StoreTranslationService(env), appId);
}

/** The language a request's shopper reads a store in, with the store's languages when they could be read. */
export interface ShopperLanguage {
	locale: Locale;
	/** Null when the store's languages could not be read. */
	ctx: StoreLanguageContext | null;
}

/**
 * The language of Estori's own pages and data on a store's address. A store with no ready language is read in its
 * source, and one that saved no settings in English. English too when the store's languages can't be read.
 */
export async function shopperLanguage(request: Request, env: Env, appId: string): Promise<ShopperLanguage> {
	try {
		const ctx = await loadStoreLanguageContext(env, appId);
		return { locale: resolveShopperLanguage(request, ctx).locale, ctx };
	} catch (error) {
		logger.warn('Store languages could not be read; the shopper is answered in English', { appId, error });
		return { locale: DEFAULT_LOCALE, ctx: null };
	}
}

export interface StorePage {
	appId: string;
	/** `''` on a live store's own address; `/space/<appId>/preview/<branch>` on a preview, as the request spelled it. */
	basePath: string;
	/** The page as the shopper's links should name it, without a preview's access token. */
	pageUrl: URL;
}

function withoutValidators(request: Request): Request {
	const headers = new Headers(request.headers);
	headers.delete('If-None-Match');
	headers.delete('If-Modified-Since');
	return new Request(request, { headers });
}

/** The store confirmed the browser's copy of a page, which may be in another language than the one it gets now. */
function confirmsPage(request: Request, response: Response): boolean {
	if (response.status !== 304) return false;
	const type = response.headers.get('Content-Type') ?? (request.headers.get('Accept') ?? '');
	return type.toLowerCase().includes('text/html');
}

/**
 * A store page from `forward`, in the shopper's language when the store has a ready language. Only GET requests are
 * looked at, and only HTML pages change. The store is asked at once, while its languages load; any failure serves the
 * store's own response.
 */
export async function serveStorePage(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
	page: StorePage,
	forward: (request: Request) => Promise<Response>,
): Promise<Response> {
	if (request.method !== 'GET') return forward(request);
	const loading = loadServingLanguages(env, page.appId).catch((error: unknown) => {
		logger.warn('Store languages could not be read; the store is served as written', { appId: page.appId, error });
		return null;
	});
	// A script or image answered before the read finishes still fills the cache for the page that follows.
	ctx.waitUntil(loading);
	let response = await forward(request);
	if (confirmsPage(request, response)) {
		if (!(await loading)) return response;
		response = await forward(withoutValidators(request));
	}
	if (!isStorePage(response)) return response;
	const languages = await loading;
	if (!languages) return response;
	try {
		const { locale, setCookie } = resolveShopperLanguage(request, languages);
		const translated = await translateStoreHtml(response, { locale, ctx: languages, basePath: page.basePath, pageUrl: page.pageUrl });
		if (setCookie) translated.headers.append('Set-Cookie', languageCookie(locale, page.basePath));
		return translated;
	} catch (error) {
		logger.warn('A store page could not be translated; it is served as written', { appId: page.appId, error });
		return response;
	}
}
