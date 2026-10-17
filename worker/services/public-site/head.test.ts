import { describe, expect, it } from 'vitest';
import { pageTitle } from '@/brand/page-title';
import { INDUSTRIES } from '@/content/industries';
import { PRICING_PAGE, industryPage, type PublicPage } from '@/content/public-pages';
import { pageHeadTags } from '@/lib/page-head';
import { writePageHead } from './head';
import { INDEX_HTML, ORIGIN, headElements, htmlResponse } from './test-fixtures';

async function writtenHead(page: PublicPage) {
	return headElements(await writePageHead(htmlResponse(), page, ORIGIN).text());
}

describe('writePageHead', () => {
	it("puts the page's title and description in place of index.html's, still marked for the page to replace", async () => {
		const head = await writtenHead(PRICING_PAGE);
		const titles = head.filter((element) => element.tag === 'title');
		expect(titles).toEqual([{ tag: 'title', attributes: { 'data-default': '' }, text: pageTitle(PRICING_PAGE.title) }]);
		const descriptions = head.filter((element) => element.attributes.name === 'description');
		expect(descriptions).toEqual([{ tag: 'meta', attributes: { name: 'description', 'data-default': '', content: PRICING_PAGE.description }, text: '' }]);
	});

	it('adds the same canonical, Open Graph and X tags the page renders, each marked for the page to replace', async () => {
		const page = industryPage(INDUSTRIES[0]);
		const head = await writtenHead(page);
		for (const tag of pageHeadTags(page, ORIGIN)) {
			expect(head, JSON.stringify(tag.attributes)).toContainEqual({ tag: tag.name, attributes: { ...tag.attributes, 'data-default': '' }, text: '' });
		}
	});

	it("adds the page's structured data as a script, marked for the page to replace", async () => {
		const page = industryPage(INDUSTRIES[0]);
		const scripts = (await writtenHead(page)).filter((element) => element.attributes.type === 'application/ld+json');
		expect(scripts).toHaveLength(1);
		expect(scripts[0].attributes).toHaveProperty('data-default');
		expect(JSON.parse(scripts[0].text)).toEqual(page.structuredData?.(ORIGIN));
	});

	it('adds no structured data to a page without any', async () => {
		const head = await writtenHead(PRICING_PAGE);
		expect(head.some((element) => element.attributes.type === 'application/ld+json')).toBe(false);
	});

	it('keeps quotes and markup in the copy as text, so they can never add elements', async () => {
		const page: PublicPage = {
			path: '/pricing',
			title: '</title><script>alert(1)</script>',
			description: 'Say "hi" & <b>bye</b>',
			image: { src: '/a.webp', alt: '"><script>alert(2)</script>' },
		};
		const unchanged = await headElements(INDEX_HTML);
		const head = await writtenHead(page);
		expect(head.filter((element) => element.tag === 'script')).toHaveLength(unchanged.filter((element) => element.tag === 'script').length);
		expect(head.find((element) => element.tag === 'title')?.text).toBe(pageTitle(page.title));
		expect(head.find((element) => element.attributes.name === 'description')?.attributes.content).toBe(page.description);
		expect(head.find((element) => element.attributes.property === 'og:image:alt')?.attributes.content).toBe(page.image?.alt);
	});

	it('serves the rest of index.html as it is, without the validators of the file it rewrote', async () => {
		const response = writePageHead(htmlResponse(INDEX_HTML, { etag: '"index"', 'cache-control': 'public, max-age=0, must-revalidate' }), PRICING_PAGE, ORIGIN);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
		expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
		expect(response.headers.has('etag')).toBe(false);
		const html = await response.text();
		expect(html.slice(html.indexOf('<body>'))).toBe(INDEX_HTML.slice(INDEX_HTML.indexOf('<body>')));
	});
});
