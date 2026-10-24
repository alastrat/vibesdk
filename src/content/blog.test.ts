import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router';
import BlogPostPage from '@/routes/blog/BlogPostPage';
import { applyAccountLocale } from '@/lib/i18n';
import { PLATFORM_FEE_LABEL } from '@/api-types';
import { ANNOUNCEMENT_POST, BLOG_CATEGORIES, BLOG_POSTS, blogPostPath, findBlogPost, postsInCategory } from './blog';

// The article is rendered for real; only unrelated head and auth-dependent CTA plumbing is omitted.
vi.mock('@/components/public-site/solution-page', () => ({ PageMeta: () => null }));
vi.mock('@/components/public-site/StartBuildingButton', () => ({ StartBuildingButton: () => null }));

afterEach(async () => {
	await applyAccountLocale('en');
});

describe('blog', () => {
	it('lists posts newest first, each with a unique slug', () => {
		const dates = BLOG_POSTS.map((post) => post.publishedAt);
		expect([...dates].sort().reverse()).toEqual(dates);
		expect(new Set(BLOG_POSTS.map((post) => post.slug)).size).toBe(BLOG_POSTS.length);
	});

	it('files every post under categories the blog lists', () => {
		const known = new Set(BLOG_CATEGORIES.map((category) => category.id));
		for (const post of BLOG_POSTS) {
			expect(post.categories.length, post.slug).toBeGreaterThan(0);
			for (const category of post.categories) expect(known.has(category), `${post.slug}: ${category}`).toBe(true);
		}
	});

	it('announces a post that exists, at its own path', () => {
		expect(findBlogPost(ANNOUNCEMENT_POST)).toBeDefined();
		expect(blogPostPath(ANNOUNCEMENT_POST)).toBe(`/blog/${ANNOUNCEMENT_POST}`);
		expect(findBlogPost('no-such-post')).toBeUndefined();
	});

	it('filters by category, and shows everything without one', () => {
		expect(postsInCategory(null)).toEqual(BLOG_POSTS);
		for (const category of BLOG_CATEGORIES) {
			for (const post of postsInCategory(category.id)) expect(post.categories).toContain(category.id);
		}
	});

	it('quotes the Discover fee from the code, so the post never drifts from what Estori charges', () => {
		const post = findBlogPost(ANNOUNCEMENT_POST);
		const text = JSON.stringify(post?.body);
		expect(text).toContain('{fee}');
		expect(text).not.toContain(PLATFORM_FEE_LABEL);
	});

	it.each([
		['en', 'When someone starts from it, they pay through Stripe, and you receive the price minus '],
		['es', 'Cuando alguien empieza con ella, paga por Stripe y recibes el precio menos '],
		['pt-BR', 'Quando alguém começa com seu template, paga pela Stripe, e você recebe o valor menos '],
	] as const)('substitutes the configured fee in the rendered %s article', async (locale, prefix) => {
		await applyAccountLocale(locale);
		const markup = renderToStaticMarkup(createElement(
			MemoryRouter,
			{ initialEntries: [blogPostPath(ANNOUNCEMENT_POST)] },
			createElement(Routes, null, createElement(Route, { path: '/blog/:slug', element: createElement(BlogPostPage) })),
		));
		expect(markup).toContain(`${prefix}${PLATFORM_FEE_LABEL}.`);
		expect(markup).not.toContain('{fee}');
	});
});
