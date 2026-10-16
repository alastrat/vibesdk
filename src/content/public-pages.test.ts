import { describe, expect, it } from 'vitest';
import { BLOG_POSTS, blogPostPath } from './blog';
import { INDUSTRIES, INDUSTRIES_PAGE, INDUSTRIES_PATH, industriesStructuredData, industryPath, industryStructuredData } from './industries';
import { LEGAL_DOCUMENTS, LEGAL_LINKS } from './legal/legal-documents';
import { CAPABILITIES, PLATFORM_CAPABILITIES } from '@/lib/capabilities';
import { AUDIENCES } from '@/lib/site-nav';
import { PUBLIC_PAGES, findPublicPage } from './public-pages';

const ORIGIN = 'https://estori.example';

describe('public pages', () => {
	it('lists each page once, by its own path', () => {
		const paths = PUBLIC_PAGES.map((page) => page.path);
		expect(new Set(paths).size).toBe(paths.length);
		for (const page of PUBLIC_PAGES) {
			expect(page.path, page.path).toMatch(/^\/([a-z0-9-]+(\/[a-z0-9-]+)*)?$/);
			expect(page.description.trim(), page.path).not.toBe('');
		}
	});

	it("has a page for every link in the Solutions menu's Estori for and Platform columns", () => {
		const links = [...AUDIENCES.map((item) => item.to), ...PLATFORM_CAPABILITIES.map((id) => CAPABILITIES[id].path)];
		for (const link of links) expect(findPublicPage(link.split('#')[0] ?? link), link).toBeDefined();
	});

	it('covers the marketing pages, Discover, every industry, every blog post and the legal texts', () => {
		const paths = PUBLIC_PAGES.map((page) => page.path);
		for (const path of [
			'/',
			'/pricing',
			'/pricing/calculator',
			'/contact',
			'/blog',
			INDUSTRIES_PATH,
			'/solutions/brands',
			'/solutions/resellers',
			'/solutions/digital',
			'/solutions/subscriptions',
			'/solutions/communities',
			'/platform/email-marketing',
			'/platform/web-analytics',
			'/platform/seo',
			'/agentic-commerce',
			'/creators/developers',
			'/creators/content',
			'/discover',
		]) {
			expect(paths, path).toContain(path);
		}
		for (const industry of INDUSTRIES) expect(paths).toContain(industryPath(industry.slug));
		for (const post of BLOG_POSTS) expect(paths).toContain(blogPostPath(post.slug));
		for (const link of LEGAL_LINKS) expect(paths).toContain(link.path);
	});

	it('leaves out pages for signed-in users and the sign-in pages', () => {
		for (const path of ['/chat/new', '/apps', '/settings', '/profile', '/admin/reviews', '/login', '/signup']) {
			expect(findPublicPage(path), path).toBeUndefined();
		}
	});

	it('finds a page whatever its trailing slash or letter case, as the router does', () => {
		const pricing = findPublicPage('/pricing');
		expect(pricing?.title).toBe('Pricing');
		expect(findPublicPage('/pricing/')).toBe(pricing);
		expect(findPublicPage('/Pricing')).toBe(pricing);
		expect(findPublicPage('/')?.path).toBe('/');
		expect(findPublicPage('/industries/no-such-industry')).toBeUndefined();
	});

	it("gives an industry page the industry's search copy, photo and structured data", () => {
		for (const industry of INDUSTRIES) {
			const page = findPublicPage(industryPath(industry.slug));
			expect(page, industry.slug).toMatchObject({ title: industry.metaTitle, description: industry.metaDescription, image: industry.photo });
			expect(page?.structuredData?.(ORIGIN)).toEqual(industryStructuredData(industry, ORIGIN));
		}
		const hub = findPublicPage(INDUSTRIES_PATH);
		expect(hub).toMatchObject({ title: INDUSTRIES_PAGE.metaTitle, description: INDUSTRIES_PAGE.metaDescription });
		expect(hub?.structuredData?.(ORIGIN)).toEqual(industriesStructuredData(ORIGIN));
	});

	it('describes a blog post by its summary and dates it by publication', () => {
		for (const post of BLOG_POSTS) {
			expect(findPublicPage(blogPostPath(post.slug))).toMatchObject({ title: post.title, description: post.summary, lastModified: post.publishedAt });
		}
	});

	it("names a legal page by its document's title", () => {
		for (const link of LEGAL_LINKS) {
			const { title } = LEGAL_DOCUMENTS[link.slug];
			expect(findPublicPage(link.path)).toMatchObject({ title, description: `${title} for Estori.` });
		}
	});

	it('names the home page by the brand alone', () => {
		expect(findPublicPage('/')?.title).toBeUndefined();
	});
});
