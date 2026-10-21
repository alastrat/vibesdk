import { describe, expect, it } from 'vitest';
import type { DeploymentTexts } from '@space-do/space';
import { MAX_STORE_TEXTS, MAX_TEXT_CHARS } from '../../../shared/types/store-translations';
import { extractStoreTexts, normalizeText, textHash } from './extract';

type DeploymentFile = DeploymentTexts['files'][number];

function deployment(files: DeploymentFile[], manifest: string | null = null, branch = 'main'): DeploymentTexts {
	return { branch, commitHash: 'c0ffee1', files, manifest };
}

const page = (text: string, path = '/index.html'): DeploymentFile => ({ path, kind: 'html', text });
const script = (text: string, path = '/app.js'): DeploymentFile => ({ path, kind: 'script', text });

/** The extracted texts and kinds of one source, in order. */
async function extract(...files: DeploymentFile[]): Promise<{ text: string; kind: string }[]> {
	const { texts } = await extractStoreTexts([deployment(files)]);
	return texts.map(({ text, kind }) => ({ text, kind }));
}

const pages = (...texts: string[]) => texts.map((text) => ({ text, kind: 'page' }));
const scripts = (...texts: string[]) => texts.map((text) => ({ text, kind: 'script' }));
const products = (...texts: string[]) => texts.map((text) => ({ text, kind: 'product' }));

const MANIFEST = JSON.stringify({
	version: 1,
	currency: 'usd',
	shipping: { countries: ['US'], flatRateCents: 500 },
	brand: { name: 'Northwind Tea', colors: { background: '#ffffff', text: '#111111', accent: '#0a7d5a' } },
	products: [
		{
			id: 'mug',
			name: 'Ceramic Mug',
			description: 'Holds 12 oz of tea.',
			variants: [
				{ id: 'blue', name: 'Ocean Blue', priceCents: 1800 },
				{ id: 'red', name: 'Brick Red', priceCents: 1800 },
			],
		},
		{ id: 'tin', name: 'Tea Tin', variants: [{ id: 'one', name: 'Default', priceCents: 900 }] },
	],
});

describe('normalizeText', () => {
	it('collapses every run of whitespace, no-break spaces included, to one space and trims', () => {
		expect(normalizeText('  Hello  \n\tworld 　')).toBe('Hello world');
		expect(normalizeText(' ')).toBe('');
	});

	it('decodes nothing and keeps case and punctuation', () => {
		expect(normalizeText('Fish &amp; chips, Please!')).toBe('Fish &amp; chips, Please!');
	});
});

describe('textHash', () => {
	it('is the lowercase hex SHA-256 of the text as given', async () => {
		expect(await textHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
	});
});

describe('extractStoreTexts', () => {
	it('takes text nodes and alt/title/placeholder/aria-label/meta description and og tags from html', async () => {
		const html = `<!doctype html>
<html lang="en"><head>
<title>Northwind Tea</title>
<meta name="description" content="Loose leaf tea, shipped fresh">
<meta property="og:title" content="Northwind Tea Shop">
<meta property="og:description" content="Small batches">
<meta property="og:image" content="/cover.png">
<meta name="viewport" content="width=device-width">
<meta name="keywords" content="tea, leaves">
</head><body>
<h1>Fresh tea</h1>
<img src="/a.png" alt="A steaming cup">
<a href="/menu" title="See the menu">Menu</a>
<input placeholder="Your email" aria-label="Email address">
<input type="submit" value="Join now">
<input type="BUTTON" value="Click me">
<input type="reset" value="Clear form">
<input type="text" value="Typed value">
<p>Hello <b>world</b></p>
<p>1234</p>
</body></html>`;
		expect(await extract(page(html))).toEqual(
			pages(
				'Northwind Tea',
				'Loose leaf tea, shipped fresh',
				'Northwind Tea Shop',
				'Small batches',
				'Fresh tea',
				'A steaming cup',
				'See the menu',
				'Menu',
				'Your email',
				'Email address',
				'Join now',
				'Click me',
				'Clear form',
				'Hello',
				'world',
			),
		);
	});

	it('ignores script, style, noscript, code, pre and template contents', async () => {
		const html = `<p>Visible</p>
<script>var greeting = "Not for translation";</script>
<style>.a::after { content: "Nope here"; }</style>
<noscript>Enable JavaScript please</noscript>
<p>Use <code>npm install now</code> to start</p>
<pre>keep   this exactly</pre>
<template><li>Item template text</li></template>
<p>Also visible</p>`;
		expect(await extract(page(html))).toEqual(pages('Visible', 'Use', 'to start', 'Also visible'));
	});

	it('decodes entities and collapses whitespace', async () => {
		const html = `<p>  Fish &amp; chips&nbsp;for \n\t two  </p>
<p>Fish &amp; chips for two</p>
<p>Caf&eacute; &#x1F600; open &lt;3</p>
<img alt="Tom &quot;the cat&quot; &amp; Jerry">`;
		expect(await extract(page(html))).toEqual(pages('Fish & chips for two', 'Café 😀 open <3', 'Tom "the cat" & Jerry'));
	});

	it('takes sentence-like string literals and template text from scripts, and html inside strings', async () => {
		const app = `const title = "Add to cart";
button.textContent = 'Checkout';
const note = "Line one\\nLine two";
const msg = \`Added \${name} to your bag\`;
label.innerHTML = '<span class="n">Your total</span> <a href="/cart" title="Open it">View cart</a>';
const range = { from: "Starting soon", to: "Ending later" };
const tight = "Fish &amp; chips are <b>hot</b>";
const done = "Welcome back!";`;
		const server = `export class App {
  async fetch() {
    return new Response("<h1>Our menu</h1><p>Fresh daily</p>", { headers: { "content-type": "text/html" } });
  }
}`;
		expect(await extract(script(app), script(server, 'index.js'))).toEqual(
			scripts(
				'Add to cart',
				'Checkout',
				'Line one Line two',
				'Added',
				'to your bag',
				'Your total',
				'Open it',
				'View cart',
				'Starting soon',
				'Ending later',
				'Fish & chips are',
				'hot',
				'Welcome back!',
				'Our menu',
				'Fresh daily',
			),
		);
	});

	it('skips urls, paths, selectors, camelCase/snake_case/kebab-case identifiers and import specifiers', async () => {
		const app = `import "side effect module";
import cart from "Cart Manager";
export { a } from "Some Package";
const lazy = await import("Lazy Module");
const tpl = await import(\`Template Module\`);
const fs = require("Node Thing");
fetch("/api/cart items");
const url = "https://example.com/Shop Now";
const scheme = "Visit ftp://files.example.com now";
const rel = "./assets/Big Logo.png";
const hash = "#main content";
const dot = ".card .title";
const sel1 = "div .title";
const sel2 = "ul > li.item";
const sel3 = "button.buy .label:hover";
const sel4 = "[data-role='main nav'] a";
const sel5 = "a:not(.skip) > span";
const decl = "color: red; background: blue";
const mime = "text/html; charset=utf-8";
const camel = "addToCart";
const pascal = "AddToCart";
const snake = "add_to_cart";
const snake2 = "Add_to_cart";
const kebab = "add-to-cart";
const kebab2 = "Add-to-cart";
const scream = "ADD_TO_CART";
const upper = "SALE";
const num = "12345";
const real = "Add to cart";
const word = "Shop";
const prose = "Visit example.com today";
const plus = "Tom + Jerry";
const note = "Note: this is a sentence";`;
		expect(await extract(script(app))).toEqual(scripts('Add to cart', 'Shop', 'Visit example.com today', 'Tom + Jerry', 'Note: this is a sentence'));
	});

	it('falls back to script parsing for code a module rejects, and keeps what it read before a syntax error', async () => {
		const sloppy = 'var count = 010; var label = "Sloppy mode text";';
		expect(await extract(script(sloppy))).toEqual(scripts('Sloppy mode text'));
		const broken = 'var good = "Read before"; var bad = "unterminated string\n; var late = "Never read";';
		expect(await extract(script(broken))).toEqual(scripts('Read before'));
	});

	it('takes product names, descriptions and variant names but not the brand from the manifest', async () => {
		const { texts, truncated } = await extractStoreTexts([deployment([], MANIFEST)]);
		expect(texts.map(({ text, kind }) => ({ text, kind }))).toEqual(
			products('Ceramic Mug', 'Holds 12 oz of tea.', 'Ocean Blue', 'Brick Red', 'Tea Tin', 'Default'),
		);
		expect(truncated).toBe(false);
	});

	it('skips texts over MAX_TEXT_CHARS and stops at MAX_STORE_TEXTS with truncated true', async () => {
		const longest = 'a'.repeat(MAX_TEXT_CHARS);
		const tooLong = 'a'.repeat(MAX_TEXT_CHARS + 1);
		const { texts } = await extractStoreTexts([deployment([page(`<p>${tooLong}</p><p>${longest}</p>`)])]);
		expect(texts.map(({ text }) => text.length)).toEqual([MAX_TEXT_CHARS]);

		const items = (count: number) => Array.from({ length: count }, (_, index) => `<p>Item ${index}</p>`).join('');
		const exact = await extractStoreTexts([deployment([page(items(MAX_STORE_TEXTS) + items(3) + `<p>${tooLong}</p>`)])]);
		expect(exact.texts).toHaveLength(MAX_STORE_TEXTS);
		expect(exact.truncated).toBe(false);

		const over = await extractStoreTexts([
			deployment([page(items(MAX_STORE_TEXTS + 1))]),
			deployment([page('<p>Never reached</p>')], MANIFEST, 'draft-aaaa1111'),
		]);
		expect(over.texts).toHaveLength(MAX_STORE_TEXTS);
		expect(over.texts[MAX_STORE_TEXTS - 1].text).toBe(`Item ${MAX_STORE_TEXTS - 1}`);
		expect(over.truncated).toBe(true);
	});

	it('returns no texts for an empty deployment', async () => {
		const empty = { texts: [], truncated: false };
		expect(await extractStoreTexts([])).toEqual(empty);
		expect(await extractStoreTexts([deployment([])])).toEqual(empty);
		expect(await extractStoreTexts([deployment([page('  \n '), script('var x = 1;')], 'not json')])).toEqual(empty);
	});

	it('orders texts first-seen across sources, live then draft, and de-duplicates by hash keeping the first kind', async () => {
		const live = deployment([page('<h1>Fresh tea</h1><p>Open daily</p>'), script('const cta = "Open daily";')], null, 'live');
		const draft = deployment([page('<p>Open daily</p><p>New this week</p>')], MANIFEST, 'draft-aaaa1111');
		const { texts, truncated } = await extractStoreTexts([live, draft]);
		expect(texts.map(({ text, kind }) => ({ text, kind }))).toEqual([
			...pages('Fresh tea', 'Open daily', 'New this week'),
			...products('Ceramic Mug', 'Holds 12 oz of tea.', 'Ocean Blue', 'Brick Red', 'Tea Tin', 'Default'),
		]);
		expect(truncated).toBe(false);
		for (const { text, hash } of texts) expect(hash).toBe(await textHash(text));
	});
});
