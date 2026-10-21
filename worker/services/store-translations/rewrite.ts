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

/** The translation of a normalized text; the extractor skipped empty and over-long texts, so they have none. */
async function lookup(key: string, dictionary: ReadonlyMap<string, string>): Promise<string | undefined> {
	if (key === '' || key.length > MAX_TEXT_CHARS) return undefined;
	return dictionary.get(await textHash(key));
}

/** A text node's raw source in the language, as HTML, with its leading and trailing whitespace; null without a translation. */
async function translatedText(raw: string, dictionary: ReadonlyMap<string, string>): Promise<string | null> {
	const translation = await lookup(htmlTextKey(raw), dictionary);
	if (translation === undefined) return null;
	// trimStart and trimEnd remove what `\s` matches, in linear time on any run of whitespace.
	const decoded = decodeHTML(raw);
	const leading = decoded.slice(0, decoded.length - decoded.trimStart().length);
	const trailing = decoded.slice(decoded.trimEnd().length);
	return escapeText(leading) + escapeText(translation) + escapeText(trailing);
}

async function translateAttributes(element: Element, dictionary: ReadonlyMap<string, string>): Promise<void> {
	const attributes: Record<string, string> = {};
	for (const [name, value] of element.attributes) attributes[name] = value;
	for (const name of textAttributeNames(element.tagName.toLowerCase(), attributes)) {
		const translation = await lookup(htmlAttributeKey(attributes[name]), dictionary);
		// The rewriter escapes only quotes in what it is given, so the value goes in already escaped.
		if (translation !== undefined) element.setAttribute(name, escapeAttribute(translation));
	}
}

/**
 * Counts an element as open until its end tag; false when it has none. A self-closing SVG or MathML element, such as
 * `<svg><style/>`, has no end tag and no content, and asking for its end tag throws, which would break the page.
 */
function whileOpen(element: Element, open: () => void, close: () => void): boolean {
	try {
		element.onEndTag(close);
	} catch {
		return false;
	}
	open();
	return true;
}

/**
 * Text nodes and attributes through the dictionary. A text node's chunks are held until its last, so the whole node is
 * looked up once. Code containers keep their text and attributes, their own included; a textarea keeps only its text.
 */
function translatingRewriter(rewriter: HTMLRewriter, dictionary: ReadonlyMap<string, string>): HTMLRewriter {
	let inCode = 0;
	let inValue = 0;
	/** The element being visited is a self-closing code container, which keeps its own attributes though nothing is open. */
	let emptyCode = false;
	let node = '';
	// Handlers run in the order they are added, so an element's container handler runs before its attributes are read.
	return rewriter
		.on([...CODE_CONTAINERS].join(', '), {
			element(element) {
				emptyCode = !whileOpen(element, () => inCode++, () => inCode--);
			},
		})
		.on([...VALUE_CONTAINERS].join(', '), {
			element(element) {
				whileOpen(element, () => inValue++, () => inValue--);
			},
		})
		.on('*', {
			async element(element) {
				const keepsAttributes = inCode > 0 || emptyCode;
				emptyCode = false;
				if (!keepsAttributes) await translateAttributes(element, dictionary);
			},
		})
		.onDocument({
			async text(chunk) {
				if (inCode + inValue > 0) return;
				node += chunk.text;
				if (!chunk.lastInTextNode) {
					chunk.remove();
					return;
				}
				const raw = node;
				node = '';
				const translated = await translatedText(raw, dictionary);
				if (translated !== null || raw !== chunk.text) chunk.replace(translated ?? raw, { html: true });
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
 * alternate links and the switcher; a page in a translated language also gets its text and the overlay script.
 * Anything but a 200 HTML page, or a store with no ready language, is returned as it is.
 */
export async function translateStoreHtml(response: Response, input: TranslateHtmlInput): Promise<Response> {
	const { locale, ctx, pageUrl } = input;
	if (!isStorePage(response) || ctx.ready.length === 0) return response;
	const translating = locale !== ctx.settings.sourceLocale;
	const dictionary = translating ? await ctx.dictionary(locale) : null;
	const languages = storeLanguages(ctx);
	const head = alternateLinks(languages, ctx.settings.sourceLocale, pageUrl) + (translating ? overlayTag(input) : '');

	let rewriter = new HTMLRewriter()
		.on('html', {
			element(element) {
				element.setAttribute('lang', locale);
			},
		})
		.on('head', {
			element(element) {
				element.append(head, { html: true });
			},
		});
	if (ctx.settings.showSwitcher) {
		const switcher = languageSwitcher(locale, languages, pageUrl);
		rewriter = rewriter.on('body', {
			element(element) {
				element.append(switcher, { html: true });
			},
		});
	}
	if (dictionary) rewriter = translatingRewriter(rewriter, dictionary);

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
	const translate = async (text: string) => (await lookup(normalizeText(text), dictionary)) ?? text;
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
