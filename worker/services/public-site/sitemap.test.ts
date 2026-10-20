import { describe, expect, it } from 'vitest';
import { renderRobotsTxt, renderSitemap } from './sitemap';
import { ORIGIN } from './test-fixtures';

describe('renderSitemap', () => {
	const xml = renderSitemap(
		[
			{ path: '/', description: 'Home.' },
			{ path: '/blog/launch', title: 'Launch', description: 'News.', lastModified: '2026-10-13' },
			{ path: '/search?q=a&b', title: 'Search', description: 'Results.' },
		],
		ORIGIN,
	);

	it('is a sitemaps.org URL set', () => {
		expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true);
		expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
	});

	it('lists each page at its full address on the origin serving it, dated when its date is known', () => {
		expect(xml).toContain(`<url><loc>${ORIGIN}/</loc></url>`);
		expect(xml).toContain(`<url><loc>${ORIGIN}/blog/launch</loc><lastmod>2026-10-13</lastmod></url>`);
		expect(xml.match(/<url>/g)).toHaveLength(3);
	});

	it('escapes addresses for XML', () => {
		expect(xml).toContain(`<loc>${ORIGIN}/search?q=a&amp;b</loc>`);
	});
});

describe('renderRobotsTxt', () => {
	const robots = renderRobotsTxt(ORIGIN);

	it('points crawlers to the sitemap on the origin serving it', () => {
		expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
	});

	it('keeps crawlers out of the API and the signed-in pages, and nowhere else', () => {
		expect(robots).toContain('User-agent: *');
		const disallowed = robots
			.split('\n')
			.filter((line) => line.startsWith('Disallow:'))
			.map((line) => line.slice('Disallow:'.length).trim());
		expect(disallowed).toEqual(['/api/', '/admin/', '/chat/', '/apps', '/settings', '/profile', '/ingest/']);
	});
});
