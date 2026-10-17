import type { PublicPage } from '@/content/public-pages';
import { absoluteUrl } from '@/lib/seo';
import { escapeHtml } from '../../utils/html';

export const SITEMAP_PATH = '/sitemap.xml';
export const ROBOTS_PATH = '/robots.txt';

/** The API and the pages behind sign-in, which have nothing for search. */
const PRIVATE_PATHS = ['/api/', '/admin/', '/chat/', '/apps', '/settings', '/profile'] as const;

function renderEntry(page: PublicPage, origin: string): string {
	const lastModified = page.lastModified ? `<lastmod>${escapeHtml(page.lastModified)}</lastmod>` : '';
	return `<url><loc>${escapeHtml(absoluteUrl(page.path, origin))}</loc>${lastModified}</url>`;
}

/** The pages as a sitemaps.org URL set, with addresses on the origin serving it. */
export function renderSitemap(pages: readonly PublicPage[], origin: string): string {
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...pages.map((page) => renderEntry(page, origin)),
		'</urlset>',
		'',
	].join('\n');
}

export function renderRobotsTxt(origin: string): string {
	return ['User-agent: *', ...PRIVATE_PATHS.map((path) => `Disallow: ${path}`), '', `Sitemap: ${absoluteUrl(SITEMAP_PATH, origin)}`, ''].join('\n');
}
