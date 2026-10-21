/**
 * A store page in the shopper's language, through the real HTMLRewriter: text nodes and the attributes shoppers read,
 * entities, inline tags, chunked bodies and code left alone, and what every page of a translated store gets.
 */

import { describe, expect, it } from 'vitest';
import type { Locale } from '../../../shared/i18n/locales';
import { languageSwitcher } from './switcher';
import { translateManifest, translateStoreHtml } from './rewrite';
import { fakeLanguageContext, type FakeLanguageOptions } from './test-context';
import type { StoreManifest } from '../../../shared/types/store-payments';
import { normalizeText, textHash } from './extract';

const PAGE = new URL('https://northwind-tea.estori.shop/');

const SPANISH: Record<string, string> = {
	'Fresh tea': 'Té fresco',
	'A cup of tea': 'Una taza de té',
	'Buy now': 'Comprar ahora',
	'Your email': 'Tu correo',
	Close: 'Cerrar',
	Hello: 'Hola',
	world: 'mundo',
	', welcome!': ', ¡bienvenido!',
	'Tom "cat" & co': 'Tom "gato" & cía',
	'Fish & chips for': 'Pescado & papas para',
	'<b>Bold</b> claims': '<b>Audaces</b> promesas',
	'Fresh tea for everyone, brewed every morning': 'Té fresco para todos, preparado cada mañana',
};

function context(options: Partial<FakeLanguageOptions> = {}) {
	return fakeLanguageContext({ source: 'en', ready: ['es'], translations: { es: SPANISH }, showSwitcher: false, ...options });
}

function page(body: BodyInit, headers: Record<string, string> = {}): Response {
	return new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers } });
}

async function served(html: BodyInit, locale: Locale = 'es', options: Partial<FakeLanguageOptions> = {}, basePath = '', pageUrl = PAGE): Promise<string> {
	const response = await translateStoreHtml(page(html), { locale, ctx: context(options), basePath, pageUrl });
	return response.text();
}

/** The same HTML as a stream of `size`-byte pieces, so the rewriter sees text nodes in several chunks. */
function inPieces(html: string, size: number): ReadableStream<Uint8Array> {
	const bytes = new TextEncoder().encode(html);
	let offset = 0;
	return new ReadableStream({
		pull(controller) {
			if (offset >= bytes.length) return controller.close();
			controller.enqueue(bytes.slice(offset, offset + size));
			offset += size;
		},
	});
}

describe('translateStoreHtml', () => {
	it('translates text nodes and the listed attributes and sets html lang', async () => {
		const html =
			'<html lang="en"><p title="Fresh tea" data-note="Fresh tea">Fresh tea</p><img alt="A cup of tea" src="/cup.png">' +
			'<input type="submit" value="Buy now"><input type="text" value="Buy now"><input type="BUTTON" value="Buy now">' +
			'<meta name="description" content="Fresh tea"><meta property="og:title" content="Fresh tea"><meta name="keywords" content="Fresh tea">' +
			'<input placeholder="Your email"><button aria-label="Close">Close</button></html>';
		expect(await served(html)).toBe(
			'<html lang="es"><p title="Té fresco" data-note="Fresh tea">Té fresco</p><img alt="Una taza de té" src="/cup.png">' +
				'<input type="submit" value="Comprar ahora"><input type="text" value="Buy now"><input type="BUTTON" value="Comprar ahora">' +
				'<meta name="description" content="Té fresco"><meta property="og:title" content="Té fresco"><meta name="keywords" content="Fresh tea">' +
				'<input placeholder="Tu correo"><button aria-label="Cerrar">Cerrar</button></html>',
		);
	});

	it('keeps markup around inline tags and leaves untranslated text as is', async () => {
		const html = '<p>\n  Hello <b>world</b>, welcome!\n</p><p class="note">Not in the dictionary &amp; kept&#33;</p>';
		expect(await served(html)).toBe('<p>\n  Hola <b>mundo</b>, ¡bienvenido!\n</p><p class="note">Not in the dictionary &amp; kept&#33;</p>');
	});

	it('handles text split across chunks', async () => {
		const html = '<main><p>\n    Fresh tea for everyone,\n    brewed every morning\n  </p><p>Nothing &amp; nobody   translates this one</p></main>';
		for (const size of [1, 3, 7, 64]) {
			const response = await translateStoreHtml(page(inPieces(html, size)), { locale: 'es', ctx: context(), basePath: '', pageUrl: PAGE });
			expect(await response.text(), `pieces of ${size}`).toBe(
				'<main><p>\n    Té fresco para todos, preparado cada mañana\n  </p><p>Nothing &amp; nobody   translates this one</p></main>',
			);
		}
	});

	it('never touches script or style contents', async () => {
		const html =
			'<title>Fresh tea</title><style>.tag::after { content: "Fresh tea"; }</style><script>document.title = "Fresh tea"; if (a < b) go("<p>Fresh tea</p>");</script>' +
			'<pre title="Fresh tea">Fresh tea</pre><code title="Fresh tea">Fresh tea</code><noscript>Fresh tea</noscript>' +
			'<template><p title="Fresh tea">Fresh tea</p></template><textarea placeholder="Fresh tea">Fresh tea</textarea>' +
			'<pre><span title="Fresh tea">Fresh tea</span></pre><p title="Fresh tea">Fresh tea</p>' +
			// A self-closing style in SVG has no end tag and no content; the page goes on.
			'<svg><style title="Fresh tea"/><text>Fresh tea</text></svg>';
		expect(await served(html)).toBe(
			'<title>Té fresco</title><style>.tag::after { content: "Fresh tea"; }</style><script>document.title = "Fresh tea"; if (a < b) go("<p>Fresh tea</p>");</script>' +
				'<pre title="Fresh tea">Fresh tea</pre><code title="Fresh tea">Fresh tea</code><noscript>Fresh tea</noscript>' +
				'<template><p title="Fresh tea">Fresh tea</p></template><textarea placeholder="Té fresco">Fresh tea</textarea>' +
				'<pre><span title="Fresh tea">Fresh tea</span></pre><p title="Té fresco">Té fresco</p>' +
				'<svg><style title="Fresh tea"/><text>Té fresco</text></svg>',
		);
	});

	it('decoded entities match their dictionary keys and the output stays valid html', async () => {
		const html =
			'<p title="Tom &quot;cat&quot; &amp; co">Fish &amp; chips&nbsp;for&nbsp;<b>you</b></p>' +
			"<p data-x='a\"b'>&lt;b&gt;Bold&lt;/b&gt; claims</p><p>Fish &#38; chips for</p>";
		expect(await served(html)).toBe(
			'<p title="Tom &quot;gato&quot; &amp; cía">Pescado &amp; papas para&nbsp;<b>you</b></p>' +
				"<p data-x='a\"b'>&lt;b&gt;Audaces&lt;/b&gt; promesas</p><p>Pescado &amp; papas para</p>",
		);
	});

	it('adds hreflang links, Content-Language, Vary and the switcher only when a language is ready', async () => {
		const html = '<!doctype html><html lang="en"><head><title>Tea</title></head><body><h1>Tea</h1></body></html>';
		const headers = { 'Cache-Control': 'public, max-age=0, must-revalidate', ETag: '"abc"', Vary: 'Accept-Encoding' };
		const links =
			'<link rel="alternate" hreflang="en" href="https://northwind-tea.estori.shop/shop?page=2&amp;lang=en">' +
			'<link rel="alternate" hreflang="es" href="https://northwind-tea.estori.shop/shop?page=2&amp;lang=es">' +
			'<link rel="alternate" hreflang="x-default" href="https://northwind-tea.estori.shop/shop?page=2&amp;lang=en">';
		const pageUrl = new URL('https://northwind-tea.estori.shop/shop?page=2');

		// Served in the source language, the page is still marked and offers the other languages.
		const ctx = context({ showSwitcher: true });
		const source = await translateStoreHtml(page(html, headers), { locale: 'en', ctx, basePath: '', pageUrl });
		expect(await source.text()).toBe(
			`<!doctype html><html lang="en"><head><title>Tea</title>${links}</head><body><h1>Tea</h1>${languageSwitcher('en', ['en', 'es'], pageUrl)}</body></html>`,
		);
		expect(source.headers.get('Content-Language')).toBe('en');
		expect(source.headers.get('Vary')).toBe('Accept-Encoding, Cookie, Accept-Language');
		expect(source.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
		// The original's validator names the original's bytes.
		expect(source.headers.get('ETag')).toBeNull();

		const hidden = await translateStoreHtml(page(html, headers), { locale: 'es', ctx: context({ showSwitcher: false }), basePath: '', pageUrl });
		expect(await hidden.text()).not.toContain('<details');
		expect(hidden.headers.get('Content-Language')).toBe('es');

		// No ready language: the page is the store's own, byte for byte, headers and all.
		const untranslated = await translateStoreHtml(page(html, headers), { locale: 'en', ctx: context({ ready: [], showSwitcher: true }), basePath: '', pageUrl });
		expect(await untranslated.text()).toBe(html);
		expect(untranslated.headers.get('Content-Language')).toBeNull();
		expect(untranslated.headers.get('Vary')).toBe('Accept-Encoding');
		expect(untranslated.headers.get('ETag')).toBe('"abc"');
	});

	it('injects the overlay script with the base path on preview', async () => {
		const basePath = '/space/app_1/preview/main';
		const pageUrl = new URL(`https://build.estori.test${basePath}/about`);
		const html = '<html><head><title>About</title></head><body><p>Hello</p></body></html>';
		expect(await served(html, 'es', { showSwitcher: true }, basePath, pageUrl)).toBe(
			'<html lang="es"><head><title>About</title>' +
				`<link rel="alternate" hreflang="en" href="https://build.estori.test${basePath}/about?lang=en">` +
				`<link rel="alternate" hreflang="es" href="https://build.estori.test${basePath}/about?lang=es">` +
				`<link rel="alternate" hreflang="x-default" href="https://build.estori.test${basePath}/about?lang=en">` +
				`<script src="${basePath}/__estori/i18n.js?lang=es&amp;v=7" defer></script></head>` +
				`<body><p>Hola</p>${languageSwitcher('es', ['en', 'es'], pageUrl)}</body></html>`,
		);
		// The source needs no overlay.
		expect(await served(html, 'en', {}, basePath, pageUrl)).not.toContain('i18n.js');
	});

	it('leaves anything but a page alone', async () => {
		const ctx = context();
		const css = new Response('p::after { content: "Fresh tea" }', { headers: { 'Content-Type': 'text/css' } });
		expect(await (await translateStoreHtml(css, { locale: 'es', ctx, basePath: '', pageUrl: PAGE })).text()).toBe('p::after { content: "Fresh tea" }');
		const missing = new Response('<p>Fresh tea</p>', { status: 404, headers: { 'Content-Type': 'text/html' } });
		expect(await (await translateStoreHtml(missing, { locale: 'es', ctx, basePath: '', pageUrl: PAGE })).text()).toBe('<p>Fresh tea</p>');
	});
});

describe('the language switcher', () => {
	it("lists the store's languages by their own names, links each on this page, and labels itself in the shopper's language", () => {
		const html = languageSwitcher('pt-BR', ['en', 'es', 'pt-BR'], new URL('https://northwind-tea.estori.shop/cart?coupon=TEA&lang=es'));
		expect(html.startsWith('<details')).toBe(true);
		expect(html).toContain('position:fixed');
		expect(html).toMatch(/<summary aria-label="Idioma"[^>]*>Português<\/summary>/);
		expect(html).toMatch(/<a href="\/cart\?coupon=TEA&amp;lang=en" hreflang="en" lang="en"[^>]*>English<\/a>/);
		expect(html).toMatch(/<a href="\/cart\?coupon=TEA&amp;lang=es" hreflang="es" lang="es"[^>]*>Español<\/a>/);
		expect(html).toMatch(/<a href="\/cart\?coupon=TEA&amp;lang=pt-BR" hreflang="pt-BR" lang="pt-BR" aria-current="true"[^>]*>Português<\/a>/);
		expect(languageSwitcher('en', ['en', 'es'], PAGE)).toMatch(/<summary aria-label="Language"/);
	});
});

describe('translateManifest', () => {
	const manifest: StoreManifest = {
		version: 1,
		currency: 'usd',
		shipping: { countries: ['US', 'MX'], flatRateCents: 500, freeOverCents: 5000 },
		brand: { name: 'Northwind Tea' } as StoreManifest['brand'],
		products: [
			{
				id: 'trail-mug',
				name: 'Trail mug',
				description: 'A  sturdy mug\nfor the trail.',
				image: '/mug.png',
				variants: [
					{ id: 'trail-mug-blue', name: 'Blue', priceCents: 1800 },
					{ id: 'trail-mug-red', name: 'Red', priceCents: 1900, available: false, catalogVariantId: 'cv_9' },
				],
			},
			{ id: 'gift-card', name: 'Gift card', variants: [{ id: 'gift-card-25', name: 'Twenty-five dollars', priceCents: 2500 }] },
		],
	};

	it('replaces product names, descriptions and variant names, and nothing else', async () => {
		const translations: Record<string, string> = { 'Trail mug': 'Taza de sendero', 'A sturdy mug for the trail.': 'Una taza resistente para el sendero.', Blue: 'Azul', 'Northwind Tea': 'Té del Norte' };
		const dictionary = new Map(await Promise.all(Object.entries(translations).map(async ([source, text]): Promise<[string, string]> => [await textHash(normalizeText(source)), text])));
		const translated = await translateManifest(manifest, dictionary);
		expect(translated.products[0].name).toBe('Taza de sendero');
		expect(translated.products[0].description).toBe('Una taza resistente para el sendero.');
		expect(translated.products[0].variants.map((variant) => variant.name)).toEqual(['Azul', 'Red']);
		expect(translated.products[1]).toEqual(manifest.products[1]);
		expect(translated.brand).toEqual(manifest.brand);
		const withoutWords = (value: StoreManifest) => ({
			...value,
			products: value.products.map(({ name: _name, description: _description, ...product }) => ({ ...product, variants: product.variants.map(({ name: _variant, ...variant }) => variant) })),
		});
		expect(withoutWords(translated)).toEqual(withoutWords(manifest));
		expect(Object.keys(translated.products[1])).toEqual(Object.keys(manifest.products[1]));
	});
});
