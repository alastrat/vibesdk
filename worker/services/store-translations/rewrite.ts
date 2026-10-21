/**
 * A store's pages and data in the shopper's language. A page goes through an HTMLRewriter after the store answers:
 * text nodes and the attributes shoppers read are keyed exactly as the extractor keyed them and looked up, and every
 * page of a store with a ready language says which languages it has. Text with no translation stays byte for byte.
 */

import { decodeHTML, escapeAttribute, escapeText } from 'entities';
import type { Locale } from '../../../shared/i18n/locales';
import { STORE_PLATFORM_PREFIX, type StoreManifest } from '../../../shared/types/store-payments';
import { MAX_TEXT_CHARS } from '../../../shared/types/store-translations';
import { escapeHtml } from '../../utils/html';
import { CODE_CONTAINERS, VALUE_CONTAINERS, htmlAttributeKey, htmlTextKey, normalizeText, textAttributeNames, textHash } from './extract';
import { languageUrl, storeLanguages } from './language';
import type { StoreLanguageContext } from './serve-context';
import { languageSwitcher } from './switcher';

export const STORE_OVERLAY_PATH = `${STORE_PLATFORM_PREFIX}/i18n.js`;

/** Elements a document's head may hold, so the page's own head is still open while they come. */
const HEAD_ELEMENTS = new Set(['html', 'head', 'title', 'base', 'meta', 'link', 'style', 'script', 'noscript', 'template']);

export interface TranslateHtmlInput {
	locale: Locale;
	ctx: StoreLanguageContext;
	/** `''` on a live store; a preview's `/space/<appId>/preview/<branch>`, which Estori's own URLs need. */
	basePath: string;
	pageUrl: URL;
}

/** A response the rewriter may change: a store's HTML page that loaded. */
export function isStorePage(response: Response): boolean {
	return response.status === 200 && (response.headers.get('Content-Type') ?? '').toLowerCase().includes('text/html');
}

/** A text node's raw source in the language, as HTML, with its leading and trailing whitespace; null without a translation. */
function translatedText(raw: string, texts: ReadonlyMap<string, string>): string | null {
	const translation = texts.get(htmlTextKey(raw));
	if (translation === undefined) return null;
	// trimStart and trimEnd remove what `\s` matches, in linear time on any run of whitespace.
	const decoded = decodeHTML(raw);
	const leading = decoded.slice(0, decoded.length - decoded.trimStart().length);
	const trailing = decoded.slice(decoded.trimEnd().length);
	return escapeText(leading) + escapeText(translation) + escapeText(trailing);
}

function translateAttributes(element: Element, texts: ReadonlyMap<string, string>): void {
	const attributes: Record<string, string> = {};
	for (const [name, value] of element.attributes) attributes[name] = value;
	for (const name of textAttributeNames(element.tagName.toLowerCase(), attributes)) {
		const translation = texts.get(htmlAttributeKey(attributes[name]));
		// The rewriter escapes only quotes in what it is given, so the value goes in already escaped.
		if (translation !== undefined) element.setAttribute(name, escapeAttribute(translation));
	}
}

/**
 * Registers `handler` for the element's end tag; false when it has none. A self-closing SVG or MathML element, such as
 * `<svg><style/>`, has no end tag, and asking for its end tag throws, which would break the page mid-stream.
 */
function onEnd(element: Element, handler: (end: EndTag) => void): boolean {
	try {
		element.onEndTag(handler);
		return true;
	} catch {
		return false;
	}
}

/**
 * Text nodes and attributes through the page's translations, looked up by their normalized text. A text node's chunks
 * are held until its last, so the whole node is looked up once. Code containers keep their text and attributes, their
 * own included; a textarea keeps only its text.
 */
function translateContent(rewriter: HTMLRewriter, texts: ReadonlyMap<string, string>): void {
	let inCode = 0;
	let inValue = 0;
	/** The element being visited is a self-closing code container, which keeps its own attributes though nothing is open. */
	let emptyCode = false;
	let node = '';
	// Handlers run in the order they are added, so an element's container handler runs before its attributes are read.
	rewriter
		.on([...CODE_CONTAINERS].join(', '), {
			element(element) {
				emptyCode = !onEnd(element, () => inCode--);
				if (!emptyCode) inCode++;
			},
		})
		.on([...VALUE_CONTAINERS].join(', '), {
			element(element) {
				if (onEnd(element, () => inValue--)) inValue++;
			},
		})
		.on('*', {
			element(element) {
				const keepsAttributes = inCode > 0 || emptyCode;
				emptyCode = false;
				if (!keepsAttributes) translateAttributes(element, texts);
			},
		})
		.onDocument({
			text(chunk) {
				if (inCode + inValue > 0) return;
				node += chunk.text;
				if (!chunk.lastInTextNode) {
					chunk.remove();
					return;
				}
				const raw = node;
				node = '';
				const translated = translatedText(raw, texts);
				if (translated !== null || raw !== chunk.text) chunk.replace(translated ?? raw, { html: true });
			},
		});
}

/**
 * Sets the page's language and adds Estori's markup where the page has room for it, whatever tags it leaves out:
 * `head` at the end of the page's head, or before the first element of its body when it never opens or closes one;
 * `body` before the body's end tag, or at the end of the document without one. A fragment a store's script fetches,
 * with no doctype, html, head or body, gets neither, or each fetch would add another switcher to the page.
 */
function placeMarkup(rewriter: HTMLRewriter, locale: Locale, markup: { head: string; body: string }): void {
	let isDocument = false;
	/** The head markup was placed, or the first element of a fragment showed it has no place. */
	let headDone = false;
	let bodyDone = markup.body === '';
	rewriter
		.on('*', {
			element(element) {
				const tag = element.tagName.toLowerCase();
				if (tag === 'html' || tag === 'head' || tag === 'body') isDocument = true;
				if (tag === 'html') element.setAttribute('lang', locale);
				if (headDone) return;
				if (tag === 'head') {
					onEnd(element, (end) => {
						if (headDone) return;
						end.before(markup.head, { html: true });
						headDone = true;
					});
				} else if (!HEAD_ELEMENTS.has(tag)) {
					if (isDocument) element.before(markup.head, { html: true });
					headDone = true;
				}
			},
		})
		.on('body', {
			element(element) {
				onEnd(element, (end) => {
					if (bodyDone) return;
					end.before(markup.body, { html: true });
					bodyDone = true;
				});
			},
		})
		.onDocument({
			doctype() {
				isDocument = true;
			},
			end(end) {
				if (!isDocument) return;
				const rest = (headDone ? '' : markup.head) + (bodyDone ? '' : markup.body);
				if (rest) end.append(rest, { html: true });
			},
		});
}

/** Each language's address of this page for search engines, and the source as the default. */
function alternateLinks(languages: readonly Locale[], source: Locale, pageUrl: URL): string {
	const link = (hreflang: string, locale: Locale) => `<link rel="alternate" hreflang="${hreflang}" href="${escapeHtml(languageUrl(pageUrl, locale).toString())}">`;
	return languages.map((locale) => link(locale, locale)).join('') + link('x-default', source);
}

function overlayTag(input: TranslateHtmlInput): string {
	const src = `${input.basePath}${STORE_OVERLAY_PATH}?lang=${input.locale}&v=${input.ctx.settings.version}`;
	return `<script src="${escapeHtml(src)}" defer></script>`;
}

/**
 * A store page in `locale`. A page of a store with a ready language, in any language, is marked with it and gets the
 * alternate links and the switcher; a page in a translated language also gets its text and the overlay script. The
 * language's translations are loaded once, before the page streams. Anything but a 200 HTML page, or a store with no
 * ready language, is returned as it is.
 */
export async function translateStoreHtml(response: Response, input: TranslateHtmlInput): Promise<Response> {
	const { locale, ctx, pageUrl } = input;
	if (!isStorePage(response) || ctx.ready.length === 0) return response;
	const translating = locale !== ctx.settings.sourceLocale;
	const texts = translating ? await ctx.texts(locale) : null;
	const languages = storeLanguages(ctx);

	const rewriter = new HTMLRewriter();
	placeMarkup(rewriter, locale, {
		head: alternateLinks(languages, ctx.settings.sourceLocale, pageUrl) + (translating ? overlayTag(input) : ''),
		body: ctx.settings.showSwitcher ? languageSwitcher(locale, languages, pageUrl) : '',
	});
	if (texts) translateContent(rewriter, texts);

	const rewritten = rewriter.transform(response);
	const headers = new Headers(rewritten.headers);
	headers.set('Content-Language', locale);
	headers.append('Vary', 'Cookie, Accept-Language');
	// The store's validators name its own bytes, not this page's.
	headers.delete('ETag');
	headers.delete('Last-Modified');
	headers.delete('Content-Length');
	return new Response(rewritten.body, { status: rewritten.status, statusText: rewritten.statusText, headers });
}

/** Product names, descriptions and variant names in the dictionary's language; prices, ids and the rest as they are. */
export async function translateManifest(manifest: StoreManifest, dictionary: ReadonlyMap<string, string>): Promise<StoreManifest> {
	const translate = async (text: string) => {
		const key = normalizeText(text);
		// The extractor skips empty and over-long texts, so they have no translation.
		if (key === '' || key.length > MAX_TEXT_CHARS) return text;
		return dictionary.get(await textHash(key)) ?? text;
	};
	const products = await Promise.all(
		manifest.products.map(async (product) => {
			const translated = {
				...product,
				name: await translate(product.name),
				variants: await Promise.all(product.variants.map(async (variant) => ({ ...variant, name: await translate(variant.name) }))),
			};
			if (product.description !== undefined) translated.description = await translate(product.description);
			return translated;
		}),
	);
	return { ...manifest, products };
}
