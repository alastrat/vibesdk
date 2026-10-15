import { describe, expect, it } from 'vitest';
import { PLATFORM_FEE_LABEL } from '@/api-types';
import { ANNOUNCEMENT_POST, BLOG_CATEGORIES, BLOG_POSTS, blogPostPath, findBlogPost, postsInCategory } from './blog';

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
		expect(text).toContain(PLATFORM_FEE_LABEL);
	});
});
