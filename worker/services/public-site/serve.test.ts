import { describe, expect, it } from 'vitest';
import { pageTitle } from '@/brand/page-title';
import { INDUSTRIES, industryPath } from '@/content/industries';
import { PRICING_PAGE, PUBLIC_PAGES } from '@/content/public-pages';
import { servePublicSite } from './serve';
import { INDEX_HTML, ORIGIN, headElements, htmlResponse } from './test-fixtures';

/** The ASSETS binding, answering every request with `respond` and keeping the requests it was sent. */
function fakeAssets(respond: () => Response = () => htmlResponse(INDEX_HTML, { etag: '"index"' })) {
	const requests: Request[] = [];
	const assets = {
		async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
			requests.push(new Request(input, init));
			return respond();
		},
	};
	return { assets, requests };
}

function get(path: string, headers: Readonly<Record<string, string>> = { accept: 'text/html,application/xhtml+xml' }): Request {
	return new Request(`${ORIGIN}${path}`, { headers });
}

async function titleOf(response: Response): Promise<string | undefined> {
	return (await headElements(await response.text())).find((element) => element.tag === 'title')?.text;
}

describe('servePublicSite', () => {
	it("serves a public page's HTML with its own head", async () => {
		const industry = INDUSTRIES[0];
		const response = await servePublicSite(get(industryPath(industry.slug)), fakeAssets().assets);
		const head = await headElements(await response.text());
		expect(head.find((element) => element.tag === 'title')?.text).toBe(pageTitle(industry.metaTitle));
		expect(head.find((element) => element.attributes.rel === 'canonical')?.attributes.href).toBe(`${ORIGIN}${industryPath(industry.slug)}`);
	});

	it('serves the head to link previews and crawlers that accept anything or send no Accept header', async () => {
		expect(await titleOf(await servePublicSite(get('/pricing', { accept: '*/*' }), fakeAssets().assets))).toBe(pageTitle(PRICING_PAGE.title));
		expect(await titleOf(await servePublicSite(get('/pricing', {}), fakeAssets().assets))).toBe(pageTitle(PRICING_PAGE.title));
	});

	it("fetches the app's HTML without the visitor's validators, so there is always a page to write into", async () => {
		const { assets, requests } = fakeAssets();
		const response = await servePublicSite(get('/pricing', { accept: 'text/html', 'if-none-match': '"index"' }), assets);
		expect(response.status).toBe(200);
		expect(requests).toHaveLength(1);
		expect(requests[0].method).toBe('GET');
		expect(requests[0].url).toBe(`${ORIGIN}/`);
		expect(requests[0].headers.has('if-none-match')).toBe(false);
	});

	it('passes every other request to the assets as it is', async () => {
		const requests = [
			new Request(`${ORIGIN}/pricing`, { method: 'POST', headers: { accept: 'text/html' } }),
			get('/pricing', { accept: 'application/json' }),
			get('/chat/abc'),
			get('/industries/no-such-industry'),
			get('/favicon.svg', { accept: 'image/*' }),
		];
		for (const request of requests) {
			const assetResponse = htmlResponse();
			const fake = fakeAssets(() => assetResponse);
			expect(await servePublicSite(request, fake.assets), `${request.method} ${request.url}`).toBe(assetResponse);
			expect(fake.requests.map((sent) => [sent.method, sent.url])).toEqual([[request.method, request.url]]);
		}
	});

	it('leaves an error from the assets as it is', async () => {
		const failure = new Response('Unavailable', { status: 503 });
		expect(await servePublicSite(get('/pricing'), fakeAssets(() => failure).assets)).toBe(failure);
	});

	it('serves a sitemap of every public page on the origin serving it', async () => {
		const { assets, requests } = fakeAssets();
		const response = await servePublicSite(get('/sitemap.xml', { accept: '*/*' }), assets);
		expect(response.headers.get('content-type')).toBe('application/xml; charset=utf-8');
		const xml = await response.text();
		expect(xml.match(/<url>/g)).toHaveLength(PUBLIC_PAGES.length);
		for (const page of PUBLIC_PAGES) expect(xml).toContain(`<loc>${ORIGIN}${page.path}</loc>`);
		expect(requests).toHaveLength(0);
	});

	it('serves robots.txt pointing to the sitemap', async () => {
		const { assets, requests } = fakeAssets();
		const response = await servePublicSite(get('/robots.txt', { accept: 'text/plain' }), assets);
		expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
		expect(await response.text()).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
		expect(requests).toHaveLength(0);
	});
});
