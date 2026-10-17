import { pageTitle } from '@/brand/page-title';
import type { PublicPage } from '@/content/public-pages';
import { pageHeadTags, type HeadTag } from '@/lib/page-head';
import { serializeJsonLd } from '@/lib/seo';
import { escapeHtml } from '../../utils/html';

/** Marks the head tags that PageMeta takes out when the page renders its own, so none is left twice. */
const DEFAULT_MARKER = 'data-default';

function renderTag({ name, attributes }: HeadTag): string {
	const rendered = Object.entries(attributes).map(([attribute, value]) => ` ${attribute}="${escapeHtml(value)}"`);
	return `<${name}${rendered.join('')} ${DEFAULT_MARKER}>`;
}

function renderStructuredData(page: PublicPage, origin: string): string {
	if (!page.structuredData) return '';
	return `<script type="application/ld+json" ${DEFAULT_MARKER}>${serializeJsonLd(page.structuredData(origin))}</script>`;
}

/**
 * index.html with the page's own head, for link previews and crawlers that never run the app: its title and
 * description in place of the defaults, then its canonical, Open Graph and X tags and its structured data, all marked
 * as defaults for the running page to replace with the same tags.
 */
export function writePageHead(response: Response, page: PublicPage, origin: string): Response {
	const tags = pageHeadTags(page, origin).map(renderTag).join('') + renderStructuredData(page, origin);
	const written = new HTMLRewriter()
		.on(`title[${DEFAULT_MARKER}]`, {
			element(element) {
				element.setInnerContent(pageTitle(page.title));
			},
		})
		.on(`meta[name="description"][${DEFAULT_MARKER}]`, {
			element(element) {
				element.setAttribute('content', page.description);
			},
		})
		.on('head', {
			element(element) {
				element.append(tags, { html: true });
			},
		})
		.transform(response);
	// The ETag names index.html, not this page's HTML.
	const headers = new Headers(written.headers);
	headers.delete('etag');
	headers.delete('content-length');
	return new Response(written.body, { status: written.status, statusText: written.statusText, headers });
}
