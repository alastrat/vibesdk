import { describe, expect, it } from 'vitest';
import { languageCookie, languageUrl, resolveShopperLanguage, storeLanguages } from './language';
import { fakeLanguageContext } from './test-context';

const PAGE = 'https://northwind-tea.estori.shop/products';

function request(query = '', headers: Record<string, string> = {}): Request {
	return new Request(`${PAGE}${query}`, { headers });
}

describe('resolveShopperLanguage', () => {
	const ctx = fakeLanguageContext({ source: 'en', ready: ['es', 'pt-BR'] });

	it('lang query wins and sets the cookie', () => {
		expect(resolveShopperLanguage(request('?lang=es', { Cookie: 'estori_lang=pt-BR', 'Accept-Language': 'pt-BR' }), ctx)).toEqual({ locale: 'es', setCookie: true });
		// The cookie already says so: nothing to set.
		expect(resolveShopperLanguage(request('?lang=es', { Cookie: 'theme=dark; estori_lang=es' }), ctx)).toEqual({ locale: 'es', setCookie: false });
		// The source counts too, so a shopper can go back to it.
		expect(resolveShopperLanguage(request('?lang=en', { Cookie: 'estori_lang=es' }), ctx)).toEqual({ locale: 'en', setCookie: true });
	});

	it('cookie next', () => {
		expect(resolveShopperLanguage(request('', { Cookie: 'estori_lang=pt-BR', 'Accept-Language': 'es' }), ctx)).toEqual({ locale: 'pt-BR', setCookie: false });
		// An invalid lang is ignored, and the cookie decides.
		expect(resolveShopperLanguage(request('?lang=fr', { Cookie: 'estori_lang=pt-BR' }), ctx)).toEqual({ locale: 'pt-BR', setCookie: false });
	});

	it('accept-language only when matchBrowser', () => {
		const header = { 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8' };
		expect(resolveShopperLanguage(request('', header), ctx)).toEqual({ locale: 'es', setCookie: false });
		expect(resolveShopperLanguage(request('', { 'Accept-Language': 'pt;q=0.4, de' }), ctx)).toEqual({ locale: 'pt-BR', setCookie: false });
		const notMatching = fakeLanguageContext({ source: 'en', ready: ['es', 'pt-BR'], matchBrowser: false });
		expect(resolveShopperLanguage(request('', header), notMatching)).toEqual({ locale: 'en', setCookie: false });
		// A crawler that names no language gets the source.
		const spanishStore = fakeLanguageContext({ source: 'es', ready: ['en'] });
		expect(resolveShopperLanguage(request(), spanishStore)).toEqual({ locale: 'es', setCookie: false });
	});

	it("takes the browser's best language the store offers, and the source when it offers none", () => {
		const spanishStore = fakeLanguageContext({ source: 'es', ready: ['en'] });
		expect(resolveShopperLanguage(request('', { 'Accept-Language': 'pt-BR,en;q=0.8' }), spanishStore)).toEqual({ locale: 'en', setCookie: false });
		expect(resolveShopperLanguage(request('', { 'Accept-Language': 'fr' }), spanishStore)).toEqual({ locale: 'es', setCookie: false });
		expect(resolveShopperLanguage(request('', { 'Accept-Language': 'fr, en;q=0' }), spanishStore)).toEqual({ locale: 'es', setCookie: false });
	});

	it('an unready or unknown language falls back to source', () => {
		const partly = fakeLanguageContext({ source: 'es', ready: ['en'], targets: { 'pt-BR': { enabled: true, ready: false } } });
		expect(resolveShopperLanguage(request('?lang=pt-BR', { Cookie: 'estori_lang=pt-BR', 'Accept-Language': 'pt-BR' }), partly)).toEqual({ locale: 'es', setCookie: false });
		expect(resolveShopperLanguage(request('?lang=xx', { Cookie: 'estori_lang=../en' }), partly)).toEqual({ locale: 'es', setCookie: false });
		// Ready but turned off by the seller.
		const off = fakeLanguageContext({ source: 'en', ready: [], targets: { es: { enabled: false, ready: true } } });
		expect(resolveShopperLanguage(request('?lang=es'), off)).toEqual({ locale: 'en', setCookie: false });
	});
});

describe('store languages', () => {
	it('lists the source and the ready languages in a fixed order', () => {
		expect(storeLanguages(fakeLanguageContext({ source: 'pt-BR', ready: ['en'] }))).toEqual(['en', 'pt-BR']);
		expect(storeLanguages(fakeLanguageContext({ source: 'es', ready: [] }))).toEqual(['es']);
	});

	it("links a language on the same page, keeping the page's other query parameters", () => {
		expect(languageUrl(new URL(`${PAGE}?page=2&lang=es#reviews`), 'pt-BR').toString()).toBe(`${PAGE}?page=2&lang=pt-BR`);
	});

	it("never links off the store's origin, however the path starts", () => {
		for (const path of ['//evil.example/login', '///evil.example', '/\\evil.example/x']) {
			const url = languageUrl(new URL(`https://northwind-tea.estori.shop${path}?next=1`), 'es');
			expect(url.origin, path).toBe('https://northwind-tea.estori.shop');
			expect(url.pathname.startsWith('//'), path).toBe(false);
		}
		expect(languageUrl(new URL('https://northwind-tea.estori.shop//evil.example/login'), 'es').toString()).toBe('https://northwind-tea.estori.shop/evil.example/login?lang=es');
	});

	it('keeps the cookie for a year on the store, or on the preview it was set on', () => {
		expect(languageCookie('es', '')).toBe('estori_lang=es; Path=/; Max-Age=31536000; SameSite=Lax; Secure');
		expect(languageCookie('pt-BR', '/space/app_1/preview/main')).toBe('estori_lang=pt-BR; Path=/space/app_1/preview/main/; Max-Age=31536000; SameSite=Lax; Secure');
	});
});
