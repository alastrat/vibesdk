/**
 * Reads the text a store shows shoppers from its built deployments: page markup, scripts and server modules, and the
 * product manifest. Each text is normalized and keyed by its hash; the serve-time rewriter looks texts up the same way.
 */

import { Parser } from 'htmlparser2';
import { decodeHTML, decodeHTMLAttribute } from 'entities';
import { tokenizer, tokTypes, type Token } from 'acorn';
import type { DeploymentTexts } from '@space-do/space';
import { MAX_STORE_TEXTS, MAX_TEXT_CHARS, type StoreText, type StoreTextKind } from '../../../shared/types/store-translations';
import { parseStoreManifest } from '../store-payments/manifest';

export interface StoreTexts {
	texts: StoreText[];
	/** The store has more texts than MAX_STORE_TEXTS, so the extraction stopped at the limit. */
	truncated: boolean;
	/** A deployment's `estori-store.json` did not parse, so its products were not read. */
	manifestInvalid: boolean;
}

/** Collapses every run of whitespace, no-break spaces included, to one space and trims. Entities are not decoded. */
export function normalizeText(raw: string): string {
	return raw.replace(/\s+/g, ' ').trim();
}

/** The key of a text node's raw source: entities decoded as a browser decodes text, then normalized. */
export function htmlTextKey(raw: string): string {
	return normalizeText(decodeHTML(raw));
}

/** The key of an attribute value's raw source: entities decoded as a browser decodes attributes, then normalized. */
export function htmlAttributeKey(raw: string): string {
	return normalizeText(decodeHTMLAttribute(raw));
}

/** The lowercase hex SHA-256 of a normalized text. */
export async function textHash(normalized: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const LETTER = /\p{L}/u;

/** Stands for a `${...}` span in a template literal. Text that holds it is never a rendered text node. */
const SUBSTITUTION = '\u0000';

/** Distinct texts in first-seen order, up to MAX_STORE_TEXTS. */
class TextCollector {
	private readonly found = new Map<string, StoreTextKind>();
	truncated = false;

	/** Takes a text unless it has no letters, holds a substitution, is too long, or was seen before. The first text past the limit stops the store. */
	add(raw: string, kind: StoreTextKind): void {
		if (this.truncated) return;
		const text = normalizeText(raw);
		if (text.length > MAX_TEXT_CHARS || !LETTER.test(text) || text.includes(SUBSTITUTION) || this.found.has(text)) return;
		if (this.found.size >= MAX_STORE_TEXTS) {
			this.truncated = true;
			return;
		}
		this.found.set(text, kind);
	}

	entries(): [string, StoreTextKind][] {
		return [...this.found];
	}
}

// ─── HTML ───────────────────────────────────────────────────────────────────

/** Containers of code and templates: neither their text nor any attribute inside them or on them is read. */
export const CODE_CONTAINERS: ReadonlySet<string> = new Set(['script', 'style', 'noscript', 'code', 'pre', 'template']);
/** A textarea's text is a form value, but its own placeholder, title and aria-label are copy. */
export const VALUE_CONTAINERS: ReadonlySet<string> = new Set(['textarea']);
export const TEXT_ATTRIBUTES: ReadonlySet<string> = new Set(['alt', 'title', 'placeholder', 'aria-label']);
export const BUTTON_INPUT_TYPES: ReadonlySet<string> = new Set(['submit', 'button', 'reset']);

/** The `content` of a meta tag that shoppers or search results read. */
function isDescriptiveMeta(attributes: Record<string, string>): boolean {
	const name = (attributes.name ?? '').toLowerCase();
	const property = (attributes.property ?? '').toLowerCase();
	return name === 'description' || property === 'og:title' || property === 'og:description';
}

/** The names of one element's attributes that shoppers read, in source order. Names are lower-case, values raw. */
export function textAttributeNames(tag: string, attributes: Record<string, string>): string[] {
	return Object.keys(attributes).filter(
		(name) =>
			TEXT_ATTRIBUTES.has(name) ||
			(name === 'value' && tag === 'input' && BUTTON_INPUT_TYPES.has((attributes.type ?? '').trim().toLowerCase())) ||
			(name === 'content' && tag === 'meta' && isDescriptiveMeta(attributes)),
	);
}

/** The raw attribute values of one element that shoppers read, in source order. */
function textAttributes(tag: string, attributes: Record<string, string>): string[] {
	return textAttributeNames(tag, attributes).map((name) => attributes[name]);
}

/**
 * Text nodes and the attributes shoppers read, keyed from the raw source with htmlTextKey and htmlAttributeKey, which
 * the serve-time rewriter uses on what it is handed. A text node ends at any tag or comment, so `Hello <b>world</b>`
 * has two, as the rewriter sees it.
 */
function extractHtml(html: string, kind: StoreTextKind, collector: TextCollector): void {
	let inCode = 0;
	let inValue = 0;
	let node = '';
	const endNode = () => {
		if (inCode + inValue === 0) collector.add(htmlTextKey(node), kind);
		node = '';
	};
	const parser = new Parser(
		{
			onopentag(name, attributes) {
				endNode();
				if (CODE_CONTAINERS.has(name)) inCode++;
				if (VALUE_CONTAINERS.has(name)) inValue++;
				if (inCode > 0) return;
				for (const value of textAttributes(name, attributes)) collector.add(htmlAttributeKey(value), kind);
			},
			onclosetag(name) {
				endNode();
				if (CODE_CONTAINERS.has(name)) inCode--;
				if (VALUE_CONTAINERS.has(name)) inValue--;
			},
			ontext(data) {
				node += data;
			},
			oncomment: endNode,
			onend: endNode,
		},
		{ decodeEntities: false },
	);
	parser.write(html);
	parser.end();
}

// ─── Scripts ────────────────────────────────────────────────────────────────

/** A capitalized word, after any emoji, symbol, digit or bracket in front of it. */
const CAPITALIZED_WORD = /^[^\p{L}]*\p{Lu}\p{Ll}+/u;
const STARTS_WITH_CAPITAL = /^[^\p{L}]*\p{Lu}/u;
const MIME_TYPE = /^(?:application|audio|font|image|message|model|multipart|text|video|\*)\/[\w.+*-]+(?:\s*;.*)?$/i;
const IDENTIFIER_ALPHABET = /^[\p{L}\p{N}_$-]+$/u;
const JOINED_OR_CASED = /[_-]|[\p{Ll}\p{N}]\p{Lu}/u;
const SELECTOR_COMPOUND = /^([a-z][a-z0-9]*|\*)?((?:[.#][\w-]+|\[\]|::?[a-z-]+(?:\(\))?)*),?$/i;
const SELECTOR_COMBINATORS = new Set(['>', '+', '~']);
const HTML_TAGS = new Set(
	'a article aside body button dd div dl dt footer form h1 h2 h3 h4 h5 h6 header img input label li main nav ol option p section select span table tbody td textarea th thead tr ul'.split(
		' ',
	),
);
const CLASS_TOKEN = /^[a-z0-9:_/.-]+$/;
const TIME_ZONE = /^(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc|US)\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)*$/;
const EMAIL = /^\S+@\S+\.\S+$/;
const BARE_ADDRESS = /^(?:(?:mailto|tel|sms):|www\.|[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#]|$))\S*$/i;
const KEY_NAMES = new Set([
	'Escape', 'Enter', 'Tab', 'Shift', 'Control', 'Alt', 'Meta', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete', 'Bearer',
]);
/**
 * SQL has a statement's shape: a verb and the keyword that completes it. `Select a size`, `UPDATE CART` and `Create a
 * table reservation` are copy. A capitalized statement needs its keyword in capitals; other cases need the full shape.
 */
const SQL_UPPERCASE = /^(?:SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|WITH|REPLACE)\s.*\b(?:FROM|INTO|SET|TABLE|VALUES|WHERE)\b/;
const SQL_SHAPE =
	/^(?:select\s.*\sfrom\s|insert\s+(?:or\s+\w+\s+)?into\s|update\s+\S+\s+set\s|delete\s+from\s+\S+\s+where\s|create\s+(?:temp\s+|temporary\s+)?(?:unique\s+|virtual\s+)?(?:table|view|index|trigger)\s+(?:if\s+not\s+exists\s+)?[\w"]|drop\s+(?:table|index|view|trigger)\s|alter\s+table\s|with\s+(?:recursive\s+)?\S+\s+as\s*\(|replace\s+into\s)/i;
/** `PRAGMA foreign_keys = ON`: the setting's name is lowercase, which a title like `Pragma Tea Co.` is not. */
const SQL_PRAGMA = /^(?:PRAGMA|pragma|Pragma)\s+[a-z_][a-z0-9_]*\s*[=(]/;

/** A space with a letter somewhere on each side of it: two words, whatever punctuation hangs on them. */
function hasSpaceBetweenLetters(text: string): boolean {
	const first = text.search(LETTER);
	const space = first < 0 ? -1 : text.indexOf(' ', first);
	return space >= 0 && LETTER.test(text.slice(space));
}

/** A string a person reads: words with a space between them, or a capitalized word. */
function readsAsWords(text: string): boolean {
	return hasSpaceBetweenLetters(text) || CAPITALIZED_WORD.test(text);
}

/**
 * A selector needs a class, id, attribute, pseudo or combinator, or several tag names in a row (`form input`); every
 * tag in it must be a known HTML tag, written in lowercase as selectors are, so `Tom + Jerry`, `Header Nav` and
 * `Visit example.com today` are prose.
 */
function isCssSelector(text: string): boolean {
	const tokens = text.replace(/\[[^\]]*\]/g, '[]').replace(/\([^)]*\)/g, '()').split(' ');
	let qualified = false;
	let allTagged = true;
	for (const token of tokens) {
		if (SELECTOR_COMBINATORS.has(token)) {
			qualified = true;
			continue;
		}
		const match = SELECTOR_COMPOUND.exec(token);
		if (!match) return false;
		const [, tag, qualifiers] = match;
		if (!tag && !qualifiers) return false;
		if (tag && tag !== '*' && !HTML_TAGS.has(tag)) return false;
		if (!tag || tag === '*') allTagged = false;
		if (qualifiers) qualified = true;
	}
	return qualified || (tokens.length > 1 && allTagged);
}

/** Utility classes: lowercase tokens, at least one like `btn-primary`, `md:flex` or `p4`. */
function isClassList(text: string): boolean {
	const tokens = text.split(' ');
	return tokens.every((token) => CLASS_TOKEN.test(token)) && tokens.some((token) => /[a-z]/.test(token) && /[-:\d]/.test(token));
}

/** Lowercase text with a length unit, a color or a percentage in a function. A sentence starts with a capital: `Save 20% today`. */
function isCssValue(text: string): boolean {
	if (STARTS_WITH_CAPITAL.test(text)) return false;
	return /\d(?:px|r?em|vh|vw)\b/.test(text) || /\d%[,)]/.test(text) || /(?:^|[\s(,])#[0-9a-f]{3,8}\b/i.test(text);
}

function isSqlStatement(text: string): boolean {
	return SQL_UPPERCASE.test(text) || SQL_SHAPE.test(text) || SQL_PRAGMA.test(text);
}

/** One camelCase, snake_case, kebab-case or SCREAMING_CASE token. */
function isIdentifier(text: string): boolean {
	return IDENTIFIER_ALPHABET.test(text) && JOINED_OR_CASED.test(text);
}

/** A string that is only an email, a URL or a domain. */
function isOnlyAddress(text: string): boolean {
	return !text.includes(' ') && (EMAIL.test(text) || BARE_ADDRESS.test(text));
}

/** Strings that name something for code, not for a person: addresses, paths, selectors, values, statements, identifiers. */
function isCodeLike(text: string): boolean {
	return (
		/^(?:\/|\.|#|http|[{[])/.test(text) ||
		text.includes('://') ||
		text.includes(';') ||
		/\S=\S/.test(text) ||
		text === 'use strict' ||
		KEY_NAMES.has(text) ||
		MIME_TYPE.test(text) ||
		TIME_ZONE.test(text) ||
		isOnlyAddress(text) ||
		isIdentifier(text) ||
		isSqlStatement(text) ||
		isCssValue(text) ||
		isClassList(text) ||
		isCssSelector(text)
	);
}

/** acorn declares its tokens without `value`, which string, template and name tokens carry. */
type ScriptToken = Token & { value?: unknown };

/** The string follows `import`, `from`, `require(` or `import(`, so it names a module. */
function isModuleSpecifier(before: ScriptToken[]): boolean {
	const last = before.at(-1);
	if (!last) return false;
	if (last.type === tokTypes._import || (last.type === tokTypes.name && last.value === 'from')) return true;
	const callee = before.at(-2);
	return last.type === tokTypes.parenL && callee !== undefined && (callee.type === tokTypes._import || (callee.type === tokTypes.name && callee.value === 'require'));
}

const MODULE_BANNER = /^\s*(?:[a-z][\w-]*:(?!\/\/))?([\w@.$~+/-]+)\s*$/i;

/**
 * Whether a line comment is a bundler's module banner (`// virtual:node_modules/hono/dist/index.js`) for a library:
 * true, false for the store's own module, null for any other comment.
 */
function bannerIsLibrary(comment: string): boolean | null {
	const path = MODULE_BANNER.exec(comment)?.[1];
	if (path === undefined || !/[/.]/.test(path)) return null;
	return /(?:^|\/)node_modules\//.test(path);
}

/** A template literal being read: its quasis, with a SUBSTITUTION where each `${...}` was. */
interface TemplateFrame {
	parts: string[];
	/** The quasi just read, so the next token is `${` or the closing backquote. */
	afterQuasi: boolean;
	skip: boolean;
}

interface ScriptRead {
	strings: string[];
	/** The whole source was tokenized. */
	complete: boolean;
	/** Where tokenizing stopped, so the better of two attempts can be told. */
	end: number;
}

/**
 * The string literals of a script and each template literal as one string, a template read when it closes. Module
 * specifiers and everything after a node_modules banner are left out. A syntax error ends the read there.
 */
function readScriptStrings(source: string, sourceType: 'module' | 'script'): ScriptRead {
	const strings: string[] = [];
	const templates: TemplateFrame[] = [];
	const recent: ScriptToken[] = [];
	let inLibrary = false;
	let end = 0;
	try {
		const tokens: Iterable<ScriptToken> = tokenizer(source, {
			ecmaVersion: 'latest',
			sourceType,
			onComment: (isBlock, comment) => {
				if (!isBlock) inLibrary = bannerIsLibrary(comment) ?? inLibrary;
			},
		});
		for (const token of tokens) {
			end = token.end;
			const template = templates.at(-1);
			if (token.type === tokTypes.backQuote) {
				if (template?.afterQuasi) {
					templates.pop();
					if (!template.skip) strings.push(template.parts.join(''));
				} else {
					templates.push({ parts: [], afterQuasi: false, skip: inLibrary || isModuleSpecifier(recent) });
				}
			} else if (token.type === tokTypes.template || token.type === tokTypes.invalidTemplate) {
				if (template) {
					template.parts.push(typeof token.value === 'string' ? token.value : SUBSTITUTION);
					template.afterQuasi = true;
				}
			} else if (token.type === tokTypes.dollarBraceL) {
				if (template) {
					template.parts.push(SUBSTITUTION);
					template.afterQuasi = false;
				}
			} else if (token.type === tokTypes.string && typeof token.value === 'string' && !inLibrary && !isModuleSpecifier(recent)) {
				strings.push(token.value);
			}
			recent.push(token);
			if (recent.length > 2) recent.shift();
		}
		return { strings, complete: true, end };
	} catch {
		// A store's script may be half-written or use syntax the tokenizer rejects; what was read before the error stays.
		return { strings, complete: false, end };
	}
}

/** Reads as a module, then as a classic script when the module read fails, keeping whichever got further. */
function scriptStrings(source: string): string[] {
	const asModule = readScriptStrings(source, 'module');
	if (asModule.complete) return asModule.strings;
	const asScript = readScriptStrings(source, 'script');
	return asScript.end >= asModule.end ? asScript.strings : asModule.strings;
}

/**
 * String literals and template text that read as words. A string with markup goes through the HTML reader, which
 * takes what a rendered page would have as text nodes; one without is decoded as `innerHTML` would decode it.
 */
function extractScript(source: string, collector: TextCollector): void {
	for (const value of scriptStrings(source)) {
		if (collector.truncated) return;
		if (value.includes('<')) {
			extractHtml(value, 'script', collector);
			continue;
		}
		const text = htmlTextKey(value);
		if (text.length <= MAX_TEXT_CHARS && !text.includes(SUBSTITUTION) && readsAsWords(text) && !isCodeLike(text)) collector.add(text, 'script');
	}
}

/** Vendored or minified scripts are libraries, not the store's own copy. */
const LIBRARY_ASSET = /\.min\.m?js$|(?:^|\/)vendor\//i;

// ─── Manifest ───────────────────────────────────────────────────────────────

/** Product names, descriptions and variant names. The brand name is the seller's, and stays as it is. Returns false when the manifest does not parse. */
function extractManifest(raw: string, collector: TextCollector): boolean {
	const parsed = parseStoreManifest(raw);
	if (!parsed.ok) return false;
	for (const product of parsed.manifest.products) {
		collector.add(product.name, 'product');
		if (product.description !== undefined) collector.add(product.description, 'product');
		for (const variant of product.variants) collector.add(variant.name, 'product');
	}
	return true;
}

// ─── Store ──────────────────────────────────────────────────────────────────

/** HTML pages first, then script assets, then server modules, whose names have no leading slash. Stable within each. */
function readingOrder(files: DeploymentTexts['files']): DeploymentTexts['files'] {
	const rank = (file: DeploymentTexts['files'][number]) => (file.kind === 'html' ? 0 : file.path.startsWith('/') ? 1 : 2);
	return [...files].sort((a, b) => rank(a) - rank(b));
}

/**
 * The distinct texts of every source, in first-seen order: sources as given, and in each its manifest, then its HTML
 * pages, script assets and server modules. A store with too many texts keeps its products and pages and loses scripts.
 */
export async function extractStoreTexts(sources: DeploymentTexts[]): Promise<StoreTexts> {
	const collector = new TextCollector();
	let manifestInvalid = false;
	for (const source of sources) {
		if (source.manifest !== null && !extractManifest(source.manifest, collector)) manifestInvalid = true;
		for (const file of readingOrder(source.files)) {
			if (collector.truncated) break;
			if (file.kind === 'html') extractHtml(file.text, 'page', collector);
			else if (!LIBRARY_ASSET.test(file.path)) extractScript(file.text, collector);
		}
		if (collector.truncated) break;
	}
	const texts = await Promise.all(collector.entries().map(async ([text, kind]) => ({ hash: await textHash(text), text, kind })));
	return { texts, truncated: collector.truncated, manifestInvalid };
}
