import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes/landing/LandingPage.tsx',
		'/src/routes/solutions/*.tsx',
		'/src/routes/platform/*.tsx',
		'/src/components/public-site/SolutionCopyPage.tsx',
		'/src/routes/agentic-commerce.tsx',
		'/src/routes/creators/*.tsx',
		'/src/routes/discover/index.tsx',
		'/src/routes/pricing.tsx',
		'/src/routes/pricing-calculator.tsx',
		'/src/routes/blog/*.tsx',
		'/src/routes/contact.tsx',
		'/src/routes/legal/LegalPage.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

/** Each page's head, as it renders it from the registry in src/content/public-pages.ts. */
const PAGE_HEADS: Readonly<Record<string, string>> = {
	'/src/routes/landing/LandingPage.tsx': '<PageMeta {...HOME_PAGE} />',
	'/src/routes/solutions/brands.tsx': '<PageMeta {...BRANDS_PAGE} />',
	'/src/routes/solutions/resellers.tsx': '<PageMeta {...RESELLERS_PAGE} />',
	'/src/routes/solutions/digital.tsx': '<PageMeta {...DIGITAL_PAGE} />',
	'/src/routes/solutions/subscriptions.tsx': 'head={SUBSCRIPTIONS_PAGE}',
	'/src/routes/solutions/communities.tsx': 'head={COMMUNITIES_PAGE}',
	'/src/routes/platform/catalog-fulfillment.tsx': 'head={CATALOG_FULFILLMENT_PAGE}',
	'/src/routes/platform/payments.tsx': 'head={PAYMENTS_PAGE}',
	'/src/routes/platform/email-marketing.tsx': 'head={EMAIL_MARKETING_PAGE}',
	'/src/routes/platform/web-analytics.tsx': 'head={WEB_ANALYTICS_PAGE}',
	'/src/routes/platform/seo.tsx': 'head={SEARCH_OPTIMIZATION_PAGE}',
	// The template the five pages above share renders the head it's given.
	'/src/components/public-site/SolutionCopyPage.tsx': '<PageMeta {...head} />',
	'/src/routes/agentic-commerce.tsx': '<PageMeta {...AGENTIC_COMMERCE_PAGE} />',
	'/src/routes/creators/developers.tsx': '<PageMeta {...DEVELOPERS_PAGE} />',
	'/src/routes/creators/content.tsx': '<PageMeta {...CONTENT_CREATORS_PAGE} />',
	'/src/routes/discover/index.tsx': '<PageMeta {...DISCOVER_PAGE} />',
	'/src/routes/pricing.tsx': '<PageMeta {...PRICING_PAGE} />',
	'/src/routes/pricing-calculator.tsx': '<PageMeta {...PRICING_CALCULATOR_PAGE} />',
	'/src/routes/blog/BlogPage.tsx': '<PageMeta {...BLOG_PAGE} />',
	'/src/routes/blog/BlogPostPage.tsx': '<PageMeta {...blogPostPage(post)} />',
	'/src/routes/contact.tsx': '<PageMeta {...CONTACT_PAGE} />',
	'/src/routes/legal/LegalPage.tsx': '<PageMeta {...legalPage(slug)} />',
};

describe('public page heads', () => {
	it('render from the registry the worker serves, so the HTML and the running page say the same', () => {
		for (const [path, head] of Object.entries(PAGE_HEADS)) expect(source(path), path).toContain(head);
	});

	it('leave the title and description to PageMeta, which takes the defaults the worker wrote out of the head', () => {
		for (const path of Object.keys(PAGE_HEADS)) {
			expect(source(path), path).not.toMatch(/<title>/);
			expect(source(path), path).not.toMatch(/<meta\s+name="description"/);
		}
	});
});
