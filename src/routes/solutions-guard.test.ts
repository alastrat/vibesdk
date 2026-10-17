import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/src/routes/solutions/*.tsx', '/src/routes/platform/*.tsx', '/src/components/public-site/SolutionCopyPage.tsx', '/src/routes/agentic-commerce.tsx', '/src/routes/creators/*.tsx', '/src/routes.tsx'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

const PAGES = [
	'/src/routes/solutions/brands.tsx',
	'/src/routes/solutions/resellers.tsx',
	'/src/routes/solutions/digital.tsx',
	'/src/routes/agentic-commerce.tsx',
];

describe('solution pages', () => {
	it('are public pages', () => {
		const routes = source('/src/routes.tsx');
		const publicBlock = routes.slice(routes.indexOf('Component: PublicShell'));
		for (const path of [
			"path: 'solutions/brands'",
			"path: 'solutions/resellers'",
			"path: 'solutions/digital'",
			"path: 'solutions/subscriptions'",
			"path: 'solutions/communities'",
			"path: 'platform/catalog-fulfillment'",
			"path: 'platform/payments'",
			"path: 'platform/email-marketing'",
			"path: 'platform/web-analytics'",
			"path: 'platform/seo'",
			"path: 'agentic-commerce'",
		]) {
			expect(publicBlock).toContain(path);
		}
	});

	it('set a title and description, and tag unbuilt capabilities from the registry', () => {
		for (const path of PAGES) {
			const page = source(path);
			expect(page, path).toContain('<PageMeta');
			expect(page, path).not.toContain('<ComingSoon');
		}
	});

	it('build the subscription, community and platform pages from their copy, with one template', () => {
		const pages: Readonly<Record<string, string>> = {
			'/src/routes/solutions/subscriptions.tsx': '<SolutionCopyPage head={SUBSCRIPTIONS_PAGE} copy={SUBSCRIPTIONS_COPY} />',
			'/src/routes/solutions/communities.tsx': '<SolutionCopyPage head={COMMUNITIES_PAGE} copy={COMMUNITIES_COPY} />',
			'/src/routes/platform/catalog-fulfillment.tsx': '<SolutionCopyPage head={CATALOG_FULFILLMENT_PAGE} copy={CATALOG_FULFILLMENT_COPY} />',
			'/src/routes/platform/email-marketing.tsx': '<SolutionCopyPage head={EMAIL_MARKETING_PAGE} copy={EMAIL_MARKETING_COPY} />',
			'/src/routes/platform/web-analytics.tsx': '<SolutionCopyPage head={WEB_ANALYTICS_PAGE} copy={WEB_ANALYTICS_COPY} />',
			'/src/routes/platform/seo.tsx': '<SolutionCopyPage head={SEARCH_OPTIMIZATION_PAGE} copy={SEARCH_OPTIMIZATION_COPY} />',
		};
		for (const [path, render] of Object.entries(pages)) expect(source(path), path).toContain(render);
		// The payments page adds the seller levels, from the limits pricing and checkout use, after its cards.
		const payments = source('/src/routes/platform/payments.tsx');
		expect(payments).toContain('<SolutionCopyPage head={PAYMENTS_PAGE} copy={PAYMENTS_COPY}>');
		expect(payments).toContain('SELLER_LEVEL_LIMITS.map');
		expect(payments).toContain('OWN_PRODUCTS_WEIGHTING');
		const template = source('/src/components/public-site/SolutionCopyPage.tsx');
		expect(template).toContain('{children}');
		for (const part of [
			'<PageMeta {...head} />',
			'tag={copy.capability}',
			'copy.sections.map',
			'<HowItWorks steps={copy.steps} />',
			'<PublicFaq items={copy.faq} />',
			'<ClosingPanel />',
		]) {
			expect(template, part).toContain(part);
		}
	});

	it('takes early-access requests on the community page, through the shared digital products list', () => {
		const template = source('/src/components/public-site/SolutionCopyPage.tsx');
		expect(template).toContain('useEarlyAccessFromUrl();');
		expect(template).toContain('isEarlyAccessCapability(copy.capability)');
		expect(template).toContain('<EarlyAccessButton capability={copy.capability}');
	});

	it('give the menu links their anchors', () => {
		const brands = source('/src/routes/solutions/brands.tsx');
		expect(brands).toMatch(/<AssistantsPanel\s+id="operations"/);
		expect(brands).toContain('<PersonalizationSection id="personalization" />');
		expect(source('/src/routes/solutions/resellers.tsx')).toContain('id="catalog"');
		// The resellers page's catalog section leads to the page about catalog and fulfillment.
		expect(source('/src/routes/solutions/resellers.tsx')).toContain('to="/platform/catalog-fulfillment"');
	});

	it('takes early-access requests for digital products, including after a sign-in that reloads the page', () => {
		const digital = source('/src/routes/solutions/digital.tsx');
		expect(digital).toContain('<EarlyAccessButton capability="digital-products"');
		expect(digital).toContain('useEarlyAccessFromUrl();');
	});
});

describe('creator pages', () => {
	it('are public pages', () => {
		const routes = source('/src/routes.tsx');
		const publicBlock = routes.slice(routes.indexOf('Component: PublicShell'));
		expect(publicBlock).toContain("path: 'creators/developers'");
		expect(publicBlock).toContain("path: 'creators/content'");
	});

	it('shows developers what they keep from the fee code, on the blue panel with AA contrast', () => {
		const earnings = source('/src/routes/creators/TemplateEarnings.tsx');
		expect(earnings).toContain('sellerKeepsCents(EXAMPLE_SALE_CENTS)');
		expect(earnings).toContain('<AnimatedBeam');
		expect(earnings).toContain('bg-public-blue');
		expect(earnings).not.toMatch(/text-white\/\d+/);
		expect(earnings).toContain('bg-black/15');
		expect(earnings).not.toContain('id="creators"');
		expect(source('/src/routes/creators/developers.tsx')).toContain('<TemplateEarnings />');
	});

	it('lays the earnings flow out in a row of four, with its beams, only from tablet width, where each step has room', () => {
		const earnings = source('/src/routes/creators/TemplateEarnings.tsx');
		expect(earnings).toContain('grid-cols-2 gap-6 md:grid-cols-4');
		expect(earnings).toContain("className: 'hidden md:block'");
		expect(earnings).not.toContain('sm:grid-cols-4');
	});

	it('takes early-access requests for the content creator program, including after a sign-in that reloads the page', () => {
		const content = source('/src/routes/creators/content.tsx');
		expect(content).toContain('<EarlyAccessButton capability="content-creators"');
		expect(content).toContain('useEarlyAccessFromUrl();');
		expect(content).not.toContain('<ComingSoon');
	});
});
