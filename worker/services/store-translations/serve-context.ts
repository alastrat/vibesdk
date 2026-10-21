/**
 * A store's languages as serving needs them, cached per isolate like store hosts: the settings for 30 seconds, and
 * each language's translations until the settings' version changes. `serveStorePage` puts a store's pages through them.
 */

import { DEFAULT_LOCALE, LOCALES, type Locale } from '../../../shared/i18n/locales';
import type { StoreTranslationSettings } from '../../../shared/types/store-translations';
import { StoreTranslationService, type StoreTranslationEntry } from '../../database/services/StoreTranslationService';
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
	/** The same translations as `[normalized source text, translation]` pairs, for the overlay script. */
	entries(locale: Locale): Promise<[string, string][]>;
}

/** Where a store's languages are read from: D1, through StoreTranslationService. */
export interface StoreLanguageSource {
	settingsOf(appId: string): Promise<StoreTranslationSettings>;
	translationsOf(appId: string, locale: Locale): Promise<StoreTranslationEntry[]>;
}

interface LoadedTranslations {
	dictionary: Map<string, string>;
	entries: [string, string][];
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

/** A loader with its own caches; the source is per call, so each request reads D1 through its own environment. */
export function createStoreLanguageLoader(nowMs: () => number = Date.now) {
	const settingsCache = new Map<string, { settings: Promise<StoreTranslationSettings>; expiresAt: number }>();
	const translationsCache = new Map<string, { version: number; loaded: Promise<LoadedTranslations> }>();

	const settingsFor = (source: StoreLanguageSource, appId: string): Promise<StoreTranslationSettings> => {
		const cached = settingsCache.get(appId);
		if (cached && cached.expiresAt > nowMs()) return cached.settings;
		const entry = { settings: source.settingsOf(appId), expiresAt: nowMs() + STORE_LANGUAGE_CACHE_MS };
		remember(settingsCache, appId, entry, SETTINGS_CACHE_MAX_ENTRIES);
		// A failed read is not kept, so the next request reads again.
		entry.settings.catch(() => settingsCache.get(appId) === entry && settingsCache.delete(appId));
		return entry.settings;
	};

	const translationsFor = (source: StoreLanguageSource, appId: string, locale: Locale, version: number): Promise<LoadedTranslations> => {
		const key = `${appId}\n${locale}`;
		const cached = translationsCache.get(key);
		if (cached?.version === version) return cached.loaded;
		const loaded = source.translationsOf(appId, locale).then((rows) => ({
			dictionary: new Map(rows.map((row) => [row.hash, row.text])),
			entries: rows.map((row): [string, string] => [row.source, row.text]),
		}));
		const entry = { version, loaded };
		remember(translationsCache, key, entry, TRANSLATIONS_CACHE_MAX_ENTRIES);
		loaded.catch(() => translationsCache.get(key) === entry && translationsCache.delete(key));
		return loaded;
	};

	return async (source: StoreLanguageSource, appId: string): Promise<StoreLanguageContext> => {
		const settings = await settingsFor(source, appId);
		return {
			appId,
			settings,
			ready: readyLanguages(settings),
			dictionary: async (locale) => (await translationsFor(source, appId, locale, settings.version)).dictionary,
			entries: async (locale) => (await translationsFor(source, appId, locale, settings.version)).entries,
		};
	};
}

const sharedLoader = createStoreLanguageLoader();

/** The store's languages, cached per isolate. */
export async function loadStoreLanguageContext(env: Env, appId: string): Promise<StoreLanguageContext> {
	return sharedLoader(new StoreTranslationService(env), appId);
}

/** The language a request's shopper reads a store in, with the store's languages when they could be read. */
export interface ShopperLanguage {
	locale: Locale;
	/** Null when the store's languages could not be read. */
	ctx: StoreLanguageContext | null;
}

/**
 * The language of Estori's own pages and data on a store's address. A store with no ready language is read in its
 * source, which is the seller's own language unless they chose another. English when the store's languages can't be read.
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

function acceptsHtml(request: Request): boolean {
	return (request.headers.get('Accept') ?? '').includes('text/html');
}

function withoutValidators(request: Request): Request {
	const headers = new Headers(request.headers);
	headers.delete('If-None-Match');
	headers.delete('If-Modified-Since');
	return new Request(request, { headers });
}

/**
 * A store page from `forward`, in the shopper's language when the store has a ready language. Only GET requests are
 * looked at, only HTML pages change, and any failure serves the store's own response.
 */
export async function serveStorePage(request: Request, env: Env, page: StorePage, forward: (request: Request) => Promise<Response>): Promise<Response> {
	if (request.method !== 'GET') return forward(request);
	const loading = loadStoreLanguageContext(env, page.appId).catch((error: unknown) => {
		logger.warn('Store languages could not be read; the store is served as written', { appId: page.appId, error });
		return null;
	});
	// The browser's copy of a page may be in another language than the one it gets now, so a store with languages
	// answers a page's revalidation in full rather than with the store's own 304.
	const revalidating = acceptsHtml(request) && (request.headers.has('If-None-Match') || request.headers.has('If-Modified-Since'));
	const early = revalidating ? await loading : null;
	const response = await forward(early && early.ready.length > 0 ? withoutValidators(request) : request);
	if (!isStorePage(response)) return response;
	const ctx = await loading;
	if (!ctx || ctx.ready.length === 0) return response;
	try {
		const { locale, setCookie } = resolveShopperLanguage(request, ctx);
		const translated = await translateStoreHtml(response, { locale, ctx, basePath: page.basePath, pageUrl: page.pageUrl });
		if (setCookie) translated.headers.append('Set-Cookie', languageCookie(locale, page.basePath));
		return translated;
	} catch (error) {
		logger.warn('A store page could not be translated; it is served as written', { appId: page.appId, error });
		return response;
	}
}
