import { PUBLIC_PAGES, findPublicPage } from '@/content/public-pages';
import { writePageHead } from './head';
import { ROBOTS_PATH, SITEMAP_PATH, renderRobotsTxt, renderSitemap } from './sitemap';

const CRAWLER_FILE_CACHE_CONTROL = 'public, max-age=3600';

/** Browsers ask for HTML by name; link previews and crawlers often accept anything, or send no Accept header. */
function acceptsHtml(request: Request): boolean {
	const accept = request.headers.get('accept');
	return accept === null || /text\/html|application\/xhtml\+xml|\*\/\*/.test(accept);
}

function crawlerFile(body: string, contentType: string): Response {
	return new Response(body, { headers: { 'content-type': contentType, 'cache-control': CRAWLER_FILE_CACHE_CONTROL } });
}

/**
 * The static assets and the app, plus what crawlers read from the public site: the sitemap, robots.txt, and each
 * public page's own head written into the HTML, since the app only sets it once its JavaScript runs.
 */
export async function servePublicSite(request: Request, assets: Pick<Fetcher, 'fetch'>): Promise<Response> {
	if (request.method !== 'GET') return assets.fetch(request);
	const url = new URL(request.url);
	if (url.pathname === SITEMAP_PATH) return crawlerFile(renderSitemap(PUBLIC_PAGES, url.origin), 'application/xml; charset=utf-8');
	if (url.pathname === ROBOTS_PATH) return crawlerFile(renderRobotsTxt(url.origin), 'text/plain; charset=utf-8');

	const page = findPublicPage(url.pathname);
	if (!page || !acceptsHtml(request)) return assets.fetch(request);
	// Without the visitor's validators: a 304 for index.html would leave no HTML to write the head into.
	const app = await assets.fetch(new URL('/', url));
	return app.ok ? writePageHead(app, page, url.origin) : app;
}
