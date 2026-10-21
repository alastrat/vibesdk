/**
 * Which language a shopper sees a store in: `?lang=`, then the cookie it sets, then the browser's languages when the
 * store matches them, then the store's source. Only the source and the ready languages can be chosen.
 */

import { LOCALES, localeFromAcceptLanguage, type Locale } from '../../../shared/i18n/locales';
import type { StoreLanguageContext } from './serve-context';

export const STORE_LANGUAGE_COOKIE = 'estori_lang';
export const STORE_LANGUAGE_PARAM = 'lang';
const COOKIE_MAX_AGE_SECONDS = 31_536_000;

/** The store's source and its ready languages, in Estori's fixed language order. */
export function storeLanguages(ctx: StoreLanguageContext): Locale[] {
	return LOCALES.filter((locale) => locale === ctx.settings.sourceLocale || ctx.ready.includes(locale));
}

function cookieLanguage(request: Request): string | null {
	for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
		const [name, ...value] = part.trim().split('=');
		if (name === STORE_LANGUAGE_COOKIE) return value.join('=');
	}
	return null;
}

export function resolveShopperLanguage(request: Request, ctx: StoreLanguageContext): { locale: Locale; setCookie: boolean } {
	const languages = storeLanguages(ctx);
	const offered = (value: string | null): value is Locale => languages.some((locale) => locale === value);
	const cookie = cookieLanguage(request);
	const asked = new URL(request.url).searchParams.get(STORE_LANGUAGE_PARAM);
	if (offered(asked)) return { locale: asked, setCookie: asked !== cookie };
	if (offered(cookie)) return { locale: cookie, setCookie: false };
	const browser = request.headers.get('Accept-Language');
	// A request that names no language, as crawlers' often don't, gets the source rather than the default language.
	if (ctx.settings.matchBrowser && browser?.trim()) {
		const preferred = localeFromAcceptLanguage(browser);
		if (offered(preferred)) return { locale: preferred, setCookie: false };
	}
	return { locale: ctx.settings.sourceLocale, setCookie: false };
}

/** The same page in another language: its other query parameters kept, its fragment dropped. */
export function languageUrl(pageUrl: URL, locale: Locale): URL {
	const url = new URL(pageUrl);
	url.hash = '';
	url.searchParams.set(STORE_LANGUAGE_PARAM, locale);
	return url;
}

/** Remembers the shopper's choice for a year, on the whole store or, on a preview, under its path. */
export function languageCookie(locale: Locale, basePath: string): string {
	return `${STORE_LANGUAGE_COOKIE}=${locale}; Path=${basePath}/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax; Secure`;
}
