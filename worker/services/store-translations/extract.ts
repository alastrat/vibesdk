/**
 * Reads the text a store shows shoppers from its built deployments: page markup, scripts and server modules, and the
 * product manifest. Each text is normalized and keyed by its hash; the serve-time rewriter looks texts up the same way.
 */

import { Parser } from 'htmlparser2';
import { tokenizer, tokTypes, type Token } from 'acorn';
import type { DeploymentTexts } from '@space-do/space';
import { MAX_STORE_TEXTS, MAX_TEXT_CHARS, type StoreText, type StoreTextKind } from '../../../shared/types/store-translations';
import { parseStoreManifest } from '../store-payments/manifest';

export interface StoreTexts {
	texts: StoreText[];
	/** The store has more texts than MAX_STORE_TEXTS, so the extraction stopped at the limit. */
	truncated: boolean;
}

/** Collapses every run of whitespace, no-break spaces included, to one space and trims. Entities are not decoded. */
export function normalizeText(raw: string): string {
	return raw.replace(/\s+/g, ' ').trim();
}

/** The lowercase hex SHA-256 of a normalized text. */
export async function textHash(normalized: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const LETTER = /\p{L}/u;

/** Distinct texts in first-seen order, up to MAX_STORE_TEXTS. */
class TextCollector {
	private readonly found = new Map<string, StoreTextKind>();
	truncated = false;

	/** Takes a text unless it has no letters, is too long, or was seen before. The first text past the limit stops the store. */
	add(raw: string, kind: StoreTextKind): void {
		if (this.truncated) return;
		const text = normalizeText(raw);
		if (text.length > MAX_TEXT_CHARS || !LETTER.test(text) || this.found.has(text)) return;
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

const SKIPPED_ELEMENTS = new Set(['script', 'style', 'noscript', 'code', 'pre', 'template']);
const TEXT_ATTRIBUTES = new Set(['alt', 'title', 'placeholder', 'aria-label']);
const BUTTON_INPUT_TYPES = new Set(['submit', 'button', 'reset']);

/** The `content` of a meta tag that shoppers or search results read. */
function isDescriptiveMeta(attributes: Record<string, string>): boolean {
	const name = (attributes.name ?? '').toLowerCase();
	const property = (attributes.property ?? '').toLowerCase();
	return name === 'description' || property === 'og:title' || property === 'og:description';
}

/** The attribute values of one element that shoppers read, in source order. */
function textAttributes(tag: string, attributes: Record<string, string>): string[] {
	const found: string[] = [];
	for (const [name, value] of Object.entries(attributes)) {
		if (TEXT_ATTRIBUTES.has(name)) found.push(value);
		else if (name === 'value' && tag === 'input' && BUTTON_INPUT_TYPES.has((attributes.type ?? '').trim().toLowerCase())) found.push(value);
		else if (name === 'content' && tag === 'meta' && isDescriptiveMeta(attributes)) found.push(value);
	}
	return found;
}

/**
 * Text nodes and the attributes shoppers read. A text node ends at any tag or comment, so `Hello <b>world</b>` has two,
 * as the serve-time rewriter sees it. Nothing inside script, style, noscript, code, pre or template counts.
 */
function extractHtml(html: string, kind: StoreTextKind, collector: TextCollector): void {
	let skipped = 0;
	let node = '';
	const endNode = () => {
		if (skipped === 0) collector.add(node, kind);
		node = '';
	};
	const parser = new Parser(
		{
			onopentag(name, attributes) {
				endNode();
				for (const value of textAttributes(name, attributes)) collector.add(value, kind);
				if (SKIPPED_ELEMENTS.has(name)) skipped++;
			},
			onclosetag(name) {
				endNode();
				if (SKIPPED_ELEMENTS.has(name)) skipped--;
			},
			ontext(data) {
				node += data;
			},
			oncomment: endNode,
			onend: endNode,
		},
		{ decodeEntities: true },
	);
	parser.write(html);
	parser.end();
}

// ─── Scripts ────────────────────────────────────────────────────────────────

const CAPITALIZED_WORD = /^\p{Lu}\p{Ll}+/u;
const MIME_TYPE = /^(?:application|audio|font|image|message|model|multipart|text|video|\*)\/[\w.+*-]+(?:\s*;.*)?$/i;
const IDENTIFIER_ALPHABET = /^[\p{L}\p{N}_$-]+$/u;
const JOINED_OR_CASED = /[_-]|[\p{Ll}\p{N}]\p{Lu}/u;
const CSS_DECLARATION = /^[a-z-]+\s*:\s*\S/;
const SELECTOR_COMPOUND = /^([a-z][a-z0-9]*|\*)?((?:[.#][\w-]+|\[\]|::?[a-z-]+(?:\(\))?)*),?$/i;
const SELECTOR_COMBINATORS = new Set(['>', '+', '~']);
const HTML_TAGS = new Set(
	'a article aside body button div footer form h1 h2 h3 h4 h5 h6 header img input label li main nav ol option p section select span table td textarea th tr ul'.split(
		' ',
	),
);

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

/** A selector needs a class, id, attribute, pseudo or combinator, and only known tags: `Tom + Jerry` is prose. */
function isCssSelector(text: string): boolean {
	const tokens = text.replace(/\[[^\]]*\]/g, '[]').replace(/\([^)]*\)/g, '()').split(' ');
	let qualified = false;
	for (const token of tokens) {
		if (SELECTOR_COMBINATORS.has(token)) {
			qualified = true;
			continue;
		}
		const match = SELECTOR_COMPOUND.exec(token);
		if (!match) return false;
		const [, tag, qualifiers] = match;
		if (!tag && !qualifiers) return false;
		if (tag && tag !== '*' && !HTML_TAGS.has(tag.toLowerCase())) return false;
		if (qualifiers) qualified = true;
	}
	return qualified;
}

/** `name: value;` pairs. Without a semicolon `note: be careful` is prose. */
function isCssDeclarations(text: string): boolean {
	if (!text.includes(';')) return false;
	const declarations = text.split(';').map((part) => part.trim()).filter((part) => part !== '');
	return declarations.length > 0 && declarations.every((declaration) => CSS_DECLARATION.test(declaration));
}

/** One camelCase, snake_case, kebab-case or SCREAMING_CASE token. */
function isIdentifier(text: string): boolean {
	return IDENTIFIER_ALPHABET.test(text) && JOINED_OR_CASED.test(text);
}

/** Strings that name something for code, not for a person: addresses, paths, selectors, declarations, types, identifiers. */
function isCodeLike(text: string): boolean {
	return (
		/^(?:\/|\.|#|http)/.test(text) ||
		text.includes('://') ||
		MIME_TYPE.test(text) ||
		isIdentifier(text) ||
		isCssDeclarations(text) ||
		isCssSelector(text)
	);
}

/** acorn declares its tokens without `value`, which string, template and name tokens carry. */
type ScriptToken = Token & { value?: unknown };

/** The string follows `import`, `from`, `require(` or `import(`, so it names a module. */
function isModuleSpecifier(before: ScriptToken[]): boolean {
	const tokens = before.at(-1)?.type === tokTypes.backQuote ? before.slice(0, -1) : before;
	const last = tokens.at(-1);
	if (!last) return false;
	if (last.type === tokTypes._import || (last.type === tokTypes.name && last.value === 'from')) return true;
	const callee = tokens.at(-2);
	return last.type === tokTypes.parenL && callee !== undefined && (callee.type === tokTypes._import || (callee.type === tokTypes.name && callee.value === 'require'));
}

interface ScriptRead {
	strings: string[];
	/** The whole source was tokenized. */
	complete: boolean;
	/** Where tokenizing stopped, so the better of two attempts can be told. */
	end: number;
}

/** The values of a script's string and template tokens, module specifiers left out. A syntax error ends the read there. */
function readScriptStrings(source: string, sourceType: 'module' | 'script'): ScriptRead {
	const strings: string[] = [];
	const recent: ScriptToken[] = [];
	let end = 0;
	try {
		const tokens: Iterable<ScriptToken> = tokenizer(source, { ecmaVersion: 'latest', sourceType });
		for (const token of tokens) {
			end = token.end;
			const isText = token.type === tokTypes.string || token.type === tokTypes.template;
			if (isText && typeof token.value === 'string' && !isModuleSpecifier(recent)) strings.push(token.value);
			recent.push(token);
			if (recent.length > 3) recent.shift();
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

/** String literals and template text that read as words. A string with markup goes through the HTML reader. */
function extractScript(source: string, collector: TextCollector): void {
	for (const value of scriptStrings(source)) {
		if (collector.truncated) return;
		if (value.includes('<')) {
			extractHtml(value, 'script', collector);
			continue;
		}
		const text = normalizeText(value);
		if (text.length <= MAX_TEXT_CHARS && readsAsWords(text) && !isCodeLike(text)) collector.add(text, 'script');
	}
}

// ─── Manifest ───────────────────────────────────────────────────────────────

/** Product names, descriptions and variant names. The brand name is the seller's, and stays as it is. */
function extractManifest(raw: string, collector: TextCollector): void {
	const parsed = parseStoreManifest(raw);
	if (!parsed.ok) return;
	for (const product of parsed.manifest.products) {
		collector.add(product.name, 'product');
		if (product.description !== undefined) collector.add(product.description, 'product');
		for (const variant of product.variants) collector.add(variant.name, 'product');
	}
}

// ─── Store ──────────────────────────────────────────────────────────────────

/** The distinct texts of every source, in first-seen order: sources as given, and in each its files, then its manifest. */
export async function extractStoreTexts(sources: DeploymentTexts[]): Promise<StoreTexts> {
	const collector = new TextCollector();
	for (const source of sources) {
		for (const file of source.files) {
			if (collector.truncated) break;
			if (file.kind === 'html') extractHtml(file.text, 'page', collector);
			else extractScript(file.text, collector);
		}
		if (source.manifest !== null) extractManifest(source.manifest, collector);
		if (collector.truncated) break;
	}
	const texts = await Promise.all(collector.entries().map(async ([text, kind]) => ({ hash: await textHash(text), text, kind })));
	return { texts, truncated: collector.truncated };
}
