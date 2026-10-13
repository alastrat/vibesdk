import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes.tsx',
		'/src/routes/discover/site.tsx',
		'/src/hooks/use-site-page.ts',
		'/src/components/site-page/SiteMainButton.tsx',
		'/src/components/site-page/SiteHeader.tsx',
		'/src/components/site-page/DevicePreview.tsx',
		'/src/components/site-page/SiteDetailsCard.tsx',
		'/src/components/site-page/StickyBuyBar.tsx',
		'/src/components/site-page/MoreFromCreator.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('the product page', () => {
	it('lives at /discover/:appId for everyone', () => {
		const routes = source('/src/routes.tsx');
		expect(routes).toContain("path: 'discover/:appId'");
		expect(routes).toContain('Component: SitePage');
	});

	it('asks signed-out visitors to sign in before buying or using, and sends buyers to Stripe', () => {
		const page = source('/src/routes/discover/site.tsx');
		expect(page).toContain('requireAuth(');
		expect(page).toContain('window.location.assign(result.checkoutUrl)');
		expect(page).toContain('checkout.isPending || checkout.isSuccess');
		expect(page).toContain('SITE_PAGE_UNAVAILABLE_MESSAGE');
		expect(page).toContain('to="/discover"');
	});

	it('waits for the session before judging the page unavailable', () => {
		const page = source('/src/routes/discover/site.tsx');
		expect(page).toContain('page.isPending');
		expect(page).not.toContain('page.isLoading');
		expect(page).toContain('!appId || page.isError');
	});

	it('keeps the live preview from reloading on refetch, with a stale time under the 30-minute token', () => {
		const hook = source('/src/hooks/use-site-page.ts');
		expect(hook).toContain('refetchOnWindowFocus: false');
		expect(hook).toContain('staleTime: 20 * 60 * 1000');
	});

	it('offers the right action for each viewer', () => {
		const button = source('/src/components/site-page/SiteMainButton.tsx');
		for (const text of ['Buy for', 'Use this site', 'Edit page', 'Not available yet']) {
			expect(button).toContain(text);
		}
	});

	it('shows the live site in a device frame with a screenshot fallback', () => {
		const preview = source('/src/components/site-page/DevicePreview.tsx');
		expect(preview).toContain('<iframe');
		expect(preview).toContain('Desktop');
		expect(preview).toContain('Phone');
		expect(preview).toContain('LOAD_TIMEOUT_MS');
		expect(preview).toContain('screenshotUrl');
		expect(source('/src/components/site-page/SiteHeader.tsx')).toContain('Open live site ↗');
	});

	it('sandboxes both preview frames with the shared token list', () => {
		const preview = source('/src/components/site-page/DevicePreview.tsx');
		expect(preview.match(/sandbox=\{PREVIEW_IFRAME_SANDBOX\}/g)).toHaveLength(2);
		expect(preview).not.toContain('allow-top-navigation');
	});

	it('prices every surface through the one label helper', () => {
		for (const file of ['SiteHeader', 'SiteDetailsCard', 'StickyBuyBar']) {
			const text = source(`/src/components/site-page/${file}.tsx`);
			expect(text).toContain('sitePriceLabel(');
			expect(text).not.toContain("'Free'");
		}
	});

	it('states what a buyer gets and keeps the action in view', () => {
		const details = source('/src/components/site-page/SiteDetailsCard.tsx');
		expect(details).toContain('What you get: your own copy of the full site, which you can keep editing with the AI.');
		expect(details).toContain('Secure checkout with Stripe');
		expect(source('/src/components/site-page/StickyBuyBar.tsx')).toContain('IntersectionObserver');
		expect(source('/src/components/site-page/MoreFromCreator.tsx')).toContain('/discover/${site.id}');
	});

	it('renders page text as plain text only', () => {
		for (const path of Object.keys(sources)) {
			expect(source(path)).not.toContain('dangerouslySetInnerHTML');
		}
	});
});
