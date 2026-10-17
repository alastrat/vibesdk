import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/routes.tsx', '/src/routes/blog/*.tsx', '/src/components/layout/SiteFooter.tsx'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('blog pages', () => {
	it('has an index and a page per post, in the public site', () => {
		const routes = source('/src/routes.tsx');
		expect(routes).toMatch(/path: 'blog',\s*Component: BlogPage,/);
		expect(routes).toMatch(/path: 'blog\/:slug',\s*Component: BlogPostPage,/);
	});

	it("follows 1Password's blog: a centred title, category links, the newest post featured, then the rest", () => {
		const index = source('/src/routes/blog/BlogPage.tsx');
		expect(index).toContain('Estori Blog');
		expect(index).toContain("[{ id: null, label: 'All' }, ...BLOG_CATEGORIES].map(");
		expect(index).toContain('postsInCategory(');
		expect(index).toContain('Latest articles');
		expect(index).toContain('<FeaturedPost');
	});

	it("follows 1Password's post: back to the blog, title, byline, hero, the article and its categories", () => {
		const post = source('/src/routes/blog/BlogPostPage.tsx');
		expect(post).toContain('Back to blog');
		expect(post).toContain('findBlogPost(');
		expect(post).toContain('Related categories');
		expect(post).toContain('<BlogArt');
		// A post that doesn't exist says so, with the way back.
		expect(post).toContain("We couldn't find that post");
	});

	it('is linked from the footer', () => {
		expect(source('/src/components/layout/SiteFooter.tsx')).toContain("{ to: '/blog', label: 'Blog' }");
	});
});
