import { describe, expect, it } from 'vitest';
import type { DeploymentTexts } from '@space-do/space';
import { MAX_STORE_TEXTS, MAX_TEXT_CHARS } from '../../../shared/types/store-translations';
import { extractStoreTexts, htmlAttributeKey, htmlTextKey, normalizeText, textHash } from './extract';

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

describe('htmlTextKey and htmlAttributeKey', () => {
	it('decode entities as a browser does, then normalize, and are the keys extraction produces', async () => {
		expect(htmlTextKey('Fish &amp; chips&nbsp;for ')).toBe('Fish & chips for');
		expect(htmlAttributeKey('Tom&nbsp;&amp;&nbsp;Jerry')).toBe('Tom & Jerry');

		// A legacy entity with no semicolon is text before `=` but stays literal in an attribute value.
		expect(htmlTextKey('Chips&copy=2')).toBe('Chips©=2');
		expect(htmlAttributeKey('Chips&copy=2')).toBe('Chips&copy=2');

		const html = '<p>Fish &amp; chips&nbsp;for </p><img alt="Chips&copy=2" title="Tom&nbsp;&amp;&nbsp;Jerry">';
		expect(await extract(page(html))).toEqual(
			pages(htmlTextKey('Fish &amp; chips&nbsp;for '), htmlAttributeKey('Chips&copy=2'), htmlAttributeKey('Tom&nbsp;&amp;&nbsp;Jerry')),
		);
		expect((await extract(page(html))).map(({ text }) => text)).toEqual(['Fish & chips for', 'Chips&copy=2', 'Tom & Jerry']);
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

	it('ignores the attributes of code containers and of what they hold, and the containers\' own', async () => {
		const html = `<img alt="Hero shot">
<code title="Copy this command">npm start</code>
<pre aria-label="Sample output"><span title="Inside pre">Done</span></pre>
<template><img alt="Product photo" src="/p.png"><button title="Buy it">Buy</button></template>
<noscript><img alt="Tracking pixel" src="/t.gif"></noscript>
<script title="Script title" type="text/template"><a title="Not parsed">Nope</a></script>
<style media="print" title="Print styles">a { color: red }</style>
<a title="After the containers">Back</a>`;
		expect(await extract(page(html))).toEqual(pages('Hero shot', 'After the containers', 'Back'));
	});

	it('keeps a textarea\'s own placeholder, title and aria-label, which are copy, and skips only its text', async () => {
		const html = `<label>Message</label>
<textarea name="note" placeholder="Tell us more" title="Your note" aria-label="Order note">Draft text &amp; more</textarea>
<p>After the form</p>`;
		expect(await extract(page(html))).toEqual(pages('Message', 'Tell us more', 'Your note', 'Order note', 'After the form'));
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
const open = \`Open every day\`;
const multi = \`First line
   second line\`;
const msg = \`Added \${name} to your bag\`;
label.innerHTML = '<span class="n">Your total</span> <a href="/cart" title="Open it">View cart</a>';
const range = { from: "Starting soon", to: "Ending later" };
const tight = "Fish &amp; chips are <b>hot</b>";
const plain = "Fish &amp; chips&nbsp;are hot";
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
				'Open every day',
				'First line second line',
				'Your total',
				'Open it',
				'View cart',
				'Starting soon',
				'Ending later',
				'Fish & chips are',
				'hot',
				'Fish & chips are hot',
				'Welcome back!',
				'Our menu',
				'Fresh daily',
			),
		);
	});

	it('reads a template literal whole: card templates give their real text, and text around a substitution is dropped', async () => {
		const app = `function card(p, price) {
  const el = document.createElement("article");
  el.innerHTML = \`<img src="\${p.image}" alt="\${p.name}">
    <h3>\${p.name}</h3>
    <p class="price">\${price}</p>
    <button data-variant="\${p.id}" onclick="addToCart('\${p.id}')">Add to cart</button>
    <a href="/products/\${p.slug}" title="\${p.name}">View details</a>
    <p>Only \${p.stock} left in stock</p>\`;
  return el;
}
const list = \`<ul>\${items.map((i) => \`<li><span>\${i.name}</span> <button>Remove</button></li>\`).join("")}</ul><p>Your bag</p>\`;
const count = \`You have \${n} items\`;
const sql = \`SELECT * FROM products WHERE id = \${id}\`;`;
		expect(await extract(script(app))).toEqual(scripts('Add to cart', 'View details', 'Remove', 'Your bag'));
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

	it('skips class lists, css values, code, key names, addresses and time zones, and keeps sentences that may be shown', async () => {
		const skipped = [
			'form input',
			'header nav',
			'section.hero h1',
			'btn btn-primary',
			'flex items-center gap-2',
			'md:flex hidden',
			'use strict',
			'1px solid #ccc',
			'0 0 10px rgba(0,0,0,.2)',
			'linear-gradient(90deg, red 0%, blue 100%)',
			'translateX(-50%) scale(1.1)',
			'color=red value',
			'a=b c',
			'one; two three',
			'America/New_York',
			'Europe/Paris',
			'America/Argentina/Buenos_Aires',
			'{ name: value }',
			'[1, 2, 3] more',
			'Orders@example.com',
			'Www.example.com',
			'Example.com/shop',
			...['Escape', 'Enter', 'Tab', 'Shift', 'Control', 'Alt', 'Meta', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete', 'Bearer'],
		];
		const taken = [
			'Failed to fetch',
			'Failed to load the cart. Please try again.',
			'Save 20% today',
			'Order #1234 confirmed',
			'Step 2 of 3',
			'page 2 of 5',
			'Hello, world',
			'(Optional)',
			'Home > Products',
			'Tom + Jerry',
			'Yes/No',
			'🛒 Cart',
			'© 2025 Northwind',
			'12 Items',
		];
		const app = [...skipped, ...taken].map((value, index) => `const v${index} = ${JSON.stringify(value)};`).join('\n');
		expect(await extract(script(app))).toEqual(scripts(...taken));
	});

	it('leaves out library strings after a node_modules banner, sql, and vendored or minified assets, keeping the app\'s own copy', async () => {
		const bundle = `// virtual:node_modules/hono/dist/context.js
var Context = class {
  finalize() { throw new Error("Context is not finalized. Did you forget to return a Response object?"); }
};
var DUPLICATE = "Can not add a route since the matcher is already built.";
// virtual:node_modules/hono/dist/router.js
var UNSUPPORTED = \`Unsupported route pattern, check the documentation\`;
// node_modules/zod/lib/index.js
var REQUIRED = "This field is required";
// virtual:src/db.ts
var SCHEMA = "CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, total INTEGER)";
var LOOKUP = "SELECT * FROM orders WHERE id = ?";
var COLUMNS = "select id, total from orders";
var PRAGMAS = "PRAGMA foreign_keys = ON";
var RECENT = "with recent as (select id from orders) select * from recent";
var INSERT = "insert into orders (id) values (?)";
var BUMP = "UPDATE orders SET total = ? WHERE id = ?";
var CLEAR = "DELETE FROM orders WHERE total = 0";
var WIDEN = "ALTER TABLE orders ADD COLUMN note TEXT";
var DROPPED = "drop table orders";
var SWAP = "REPLACE INTO orders (id) VALUES (?)";
// virtual:src/index.ts
var App = class {
  fetch() { return new Response("<h1>Our menu</h1>"); }
  hello() { return "Welcome back, friend!"; }
  labels() { return ["Select a size", "Create your account", "Update cart", "With love, Northwind"]; }
};
`;
		expect(await extract(script(bundle, 'index.js'))).toEqual(
			scripts('Our menu', 'Welcome back, friend!', 'Select a size', 'Create your account', 'Update cart', 'With love, Northwind'),
		);

		const assets = [
			script('const m = "Library message for developers";', '/vendor/chart.js'),
			script('const m = "Minified library message";', '/assets/lib.min.js'),
			script('const cta = "Add to cart";', '/js/app.js'),
			script('export const hello = "Hello there, friend";', 'index.js'),
		];
		expect(await extract(...assets)).toEqual(scripts('Add to cart', 'Hello there, friend'));
	});

	it('falls back to script parsing for code a module rejects, and keeps what it read before a syntax error', async () => {
		const sloppy = 'var count = 010; var label = "Sloppy mode text";';
		expect(await extract(script(sloppy))).toEqual(scripts('Sloppy mode text'));
		const broken = 'var good = "Read before"; var bad = "unterminated string\n; var late = "Never read";';
		expect(await extract(script(broken))).toEqual(scripts('Read before'));
	});

	it('takes product names, descriptions and variant names but not the brand from the manifest', async () => {
		const { texts, truncated, manifestInvalid } = await extractStoreTexts([deployment([], MANIFEST)]);
		expect(texts.map(({ text, kind }) => ({ text, kind }))).toEqual(
			products('Ceramic Mug', 'Holds 12 oz of tea.', 'Ocean Blue', 'Brick Red', 'Tea Tin', 'Default'),
		);
		expect(truncated).toBe(false);
		expect(manifestInvalid).toBe(false);
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
		const empty = { texts: [], truncated: false, manifestInvalid: false };
		expect(await extractStoreTexts([])).toEqual(empty);
		expect(await extractStoreTexts([deployment([])])).toEqual(empty);
		expect(await extractStoreTexts([deployment([page('  \n '), script('var x = 1;')])])).toEqual(empty);
	});

	it('reports a manifest that does not parse, from either source, and still reads the rest', async () => {
		const invalid = await extractStoreTexts([deployment([page('<p>Open daily</p>')], 'not json')]);
		expect(invalid).toMatchObject({ truncated: false, manifestInvalid: true });
		expect(invalid.texts.map(({ text }) => text)).toEqual(['Open daily']);
		expect(await extractStoreTexts([deployment([], '{"version":2}')])).toEqual({ texts: [], truncated: false, manifestInvalid: true });

		const draftOnly = await extractStoreTexts([deployment([], MANIFEST, 'live'), deployment([], '{"products":[]}', 'draft-aaaa1111')]);
		expect(draftOnly.manifestInvalid).toBe(true);
		expect(draftOnly.texts).toHaveLength(6);
	});

	it('orders each source manifest first, then html, then script assets, then server modules, and sources live then draft', async () => {
		const live = deployment(
			[
				script('export const hello = "Server says hello";', 'index.js'),
				script('const cta = "Add to cart";', '/app.js'),
				page('<h1>Fresh tea</h1>'),
				page('<p>Open daily</p>', '/about.html'),
			],
			MANIFEST,
			'live',
		);
		const draft = deployment([page('<p>Open daily</p><p>New this week</p>')], null, 'draft-aaaa1111');
		const { texts, truncated } = await extractStoreTexts([live, draft]);
		expect(texts.map(({ text, kind }) => ({ text, kind }))).toEqual([
			...products('Ceramic Mug', 'Holds 12 oz of tea.', 'Ocean Blue', 'Brick Red', 'Tea Tin', 'Default'),
			...pages('Fresh tea', 'Open daily'),
			...scripts('Add to cart', 'Server says hello'),
			...pages('New this week'),
		]);
		expect(truncated).toBe(false);
		for (const { text, hash } of texts) expect(hash).toBe(await textHash(text));
	});

	it('de-duplicates by hash across sources and kinds, keeping the first kind', async () => {
		const live = deployment([page('<p>Open daily</p>'), script('const cta = "Open daily";')], null, 'live');
		const draft = deployment([script('const cta = "Open daily";'), page('<p>  Open&nbsp;daily </p>')], null, 'draft-aaaa1111');
		expect((await extractStoreTexts([live, draft])).texts.map(({ text, kind }) => ({ text, kind }))).toEqual(pages('Open daily'));
	});

	it('keeps products when a store has too many texts: the manifest is read first and noise drops first', async () => {
		const items = Array.from({ length: MAX_STORE_TEXTS }, (_, index) => `<p>Item ${index}</p>`).join('');
		const { texts, truncated } = await extractStoreTexts([deployment([page(items)], MANIFEST)]);
		expect(texts).toHaveLength(MAX_STORE_TEXTS);
		expect(texts.slice(0, 6).map(({ text }) => text)).toEqual(['Ceramic Mug', 'Holds 12 oz of tea.', 'Ocean Blue', 'Brick Red', 'Tea Tin', 'Default']);
		expect(texts[MAX_STORE_TEXTS - 1].text).toBe(`Item ${MAX_STORE_TEXTS - 7}`);
		expect(truncated).toBe(true);
	});
});
