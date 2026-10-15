import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes.tsx',
		'/src/routes/industries/IndustryPage.tsx',
		'/src/routes/industries/IndustriesPage.tsx',
		'/src/components/public-site/IndustryCards.tsx',
		'/src/components/public-site/solution-page.tsx',
		'/src/components/public-site/JsonLd.tsx',
		'/src/components/layout/NavMenu.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

// The Workers test pool loads .html as a text module; `?raw` is not resolvable there.
const indexHtml = Object.values(import.meta.glob<string>('/index.html', { import: 'default', eager: true }))[0] ?? '';

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

const PAGE = '/src/routes/industries/IndustryPage.tsx';
const HUB = '/src/routes/industries/IndustriesPage.tsx';
const NAV = '/src/components/layout/NavMenu.tsx';

describe('industry pages', () => {
	it('has a page per industry, and a page that lists them all, in the public site', () => {
		const routes = source('/src/routes.tsx');
		expect(routes).toMatch(/path: 'industries\/:slug',\s*Component: IndustryPage,/);
		expect(routes).toMatch(/path: 'industries',\s*Component: IndustriesPage,/);
	});

	it('uses the solution page template, with example requests and what the stores can include', () => {
		const page = source(PAGE);
		for (const part of ['<SolutionHero', 'industry.prompts.map', 'cards={industry.features}', 'cards={TODAY_CARDS}', '<HowItWorks', '<ClosingPanel']) {
			expect(page, part).toContain(part);
		}
		expect(page).toContain("We couldn't find that industry");
	});

	it('shows the industry photo under the hero, sized for each screen and credited to its photographer', () => {
		const page = source(PAGE);
		expect(page).toContain('srcSet={industryPhotoSrcSet(industry.photo)}');
		expect(page).toContain('fetchPriority="high"');
		expect(page).toContain('alt={industry.photo.alt}');
		expect(page).toMatch(/Photo by \{industry\.photo\.photographer\} on Unsplash/);
		expect(page).toContain('href={industry.photo.url}');
	});

	it('answers what Estori is for the industry, then its questions, for search engines and AI assistants', () => {
		const page = source(PAGE);
		expect(page).toContain('What is Estori for {industry.audience}?');
		expect(page).toContain('{industry.summary}');
		expect(page).toContain('<PublicFaq items={industryFaq(industry)} />');
		expect(page).toContain('<JsonLd data={industryStructuredData(industry, window.location.origin)} />');
	});

	it('gives every industry page its canonical address, social preview and breadcrumb trail', () => {
		const page = source(PAGE);
		expect(page).toMatch(/<PageMeta\s+title=\{industry\.metaTitle\}\s+description=\{industry\.metaDescription\}\s+path=\{industryPath\(industry\.slug\)\}\s+image=\{industry\.photo\}/);
		expect(page).toContain('crumbs={industryCrumbs(industry)}');
		const meta = source('/src/components/public-site/solution-page.tsx');
		// The worker writes the same tags into the HTML; page-head.test.ts covers which tags they are.
		expect(meta).toContain('pageHeadTags(head, window.location.origin)');
		expect(meta).toContain('<nav aria-label="Breadcrumb"');
		expect(meta).toContain('aria-current="page"');
	});

	it("swaps index.html's default title and description for the page's own, so a page has one of each", () => {
		expect(indexHtml).toMatch(/<title data-default>/);
		expect(indexHtml).toMatch(/<meta name="description" data-default /);
		const meta = source('/src/components/public-site/solution-page.tsx');
		expect(meta).toContain("document.head.querySelectorAll('[data-default]')");
		// Put back when the page goes, for pages that set no title of their own.
		expect(meta).toContain('document.head.append(...defaults)');
	});

	it('links every industry page to the others and to the full list', () => {
		expect(source(PAGE)).toMatch(/<IndustryCards\s+industries=\{INDUSTRIES\.filter\(\(other\) => other\.slug !== industry\.slug\)\}\s+showAll/);
		const hub = source(HUB);
		expect(hub).toContain('<IndustryCards industries={INDUSTRIES} />');
		expect(hub).toContain('<JsonLd data={industriesStructuredData(window.location.origin)} />');
		expect(hub).toContain('crumbs={INDUSTRIES_CRUMBS}');
		const cards = source('/src/components/public-site/IndustryCards.tsx');
		expect(cards).toContain('loading="lazy"');
		expect(cards).toContain('srcSet={industryPhotoSrcSet(industry.photo)}');
	});

	it('writes structured data as plain script text, never as raw HTML', () => {
		const jsonLd = source('/src/components/public-site/JsonLd.tsx');
		expect(jsonLd).toContain('<script type="application/ld+json">{serializeJsonLd(data)}</script>');
		expect(jsonLd).not.toContain('dangerouslySetInnerHTML');
	});

	it('lists the industries second in the Solutions menu, in place of Get started', () => {
		const nav = source(NAV);
		const solutions = nav.slice(nav.indexOf('<Column title="Estori for"'));
		expect(solutions.indexOf('<Column title="Industries"')).toBeGreaterThan(0);
		expect(solutions.indexOf('<Column title="Industries"')).toBeLessThan(solutions.indexOf('<Column title="Platform"'));
		expect(nav).toContain('INDUSTRIES.map');
		expect(nav).not.toMatch(/solutions: \{\s*links:/);
	});

	it('gives every menu item an icon: audiences, industries, platform capabilities and creator links', () => {
		const nav = source(NAV);
		expect(nav).toContain('const INDUSTRY_ICONS: Readonly<Record<IndustrySlug, Icon>> = {');
		expect(nav).toContain('const CAPABILITY_ICONS: Readonly<Record<CapabilityId, Icon>> = {');
		expect(nav).toContain('icon: INDUSTRY_ICONS[industry.slug]');
		expect(nav).toContain('icon: CAPABILITY_ICONS[capabilityId]');
		expect(nav).toMatch(/\{ to: '\/discover', label: 'Templates in Discover', icon: \w+Icon \}/);
		expect(nav).toMatch(/\{ to: '\/pricing#developers', label: 'Fees for template sales', icon: \w+Icon \}/);
		// One item component for every column, so each draws its icon the same way.
		expect(nav).toContain('function MenuItem(');
		expect(nav).not.toContain('function TextItem(');
	});
});
