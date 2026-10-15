import { describe, expect, it } from 'vitest';
import { COMPETITORS } from './copy-rules';

const pageSources = import.meta.glob<string>(['/src/routes/landing/*.tsx', '/src/components/public-site/*.tsx'], {
	query: '?raw',
	import: 'default',
	eager: true,
});
const otherSources = import.meta.glob<string>(
	[
		'/src/routes/root-index.tsx',
		'/src/routes/pricing.tsx',
		'/src/components/build-box.tsx',
		'/src/routes/home.tsx',
		'/src/routes.tsx',
		'/src/hooks/use-scroll-grow.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = pageSources[path] ?? otherSources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}


describe('landing page', () => {
	const landing = Object.values(pageSources).join('\n');

	it('shows the landing page signed out and the builder home signed in, with a loader in between', () => {
		const root = source('/src/routes/root-index.tsx');
		expect(root).toContain('isLoading');
		expect(root).toContain('<LandingPage />');
		expect(root).toContain('<Home />');
		expect(root).toContain("view === 'loading'");
		expect(root).toContain('<Loader />');
		expect(source('/src/routes.tsx')).toContain('{ index: true, Component: RootIndex }');
	});

	it('reuses the one build box, which sends visitors to sign up and then to their build', () => {
		expect(landing).toContain('<BuildBox');
		expect(source('/src/routes/home.tsx')).toContain('<BuildBox');
		const box = source('/src/components/build-box.tsx');
		expect(box).toContain('requireFullAuth: true');
		expect(box).toContain('intendedUrl: intendedUrl');
		expect(box).toContain('<ThinkModelPicker');
	});

	it('keeps the images note on an opaque surface, readable on the dark hero', () => {
		const box = source('/src/components/build-box.tsx');
		const note = box.slice(box.lastIndexOf('<div', box.indexOf('Images Beta:')), box.indexOf('Images Beta:'));
		expect(note).toContain('bg-kumo-elevated');
		expect(note).not.toMatch(/\bbg-[\w-]+\/\d+/);
	});

	it('shows the builder demo on a bundled store image under a neutral address, with motion from Magic UI', () => {
		const hero = source('/src/routes/landing/Hero.tsx');
		expect(hero).toContain("HERO_STORE_IMAGE = '/marketing/hero-store.jpg'");
		expect(hero).toContain('url="Live preview"');
		expect(hero).toContain('<AnimatedList');
		expect(hero).toContain('<BorderBeam');
		expect(hero).toContain('id="build"');
		expect(hero).toMatch(/id="build"\s+className="app-theme-scope /);
		expect(hero).toContain('<section className="overflow-x-clip bg-public-charcoal text-white">');
	});

	it('speaks to brands first, in plain words, and marks what is still to come', () => {
		const hero = source('/src/routes/landing/Hero.tsx');
		expect(hero).toContain('AI-powered online stores');
		expect(hero).toContain('Describe your store. Estori builds it in minutes.');
		expect(hero).toContain('Next: assistants that help you sell more and handle the daily work.');
		expect(hero).not.toMatch(/agentic|wherever shoppers ask AI/i);
		expect(source('/src/routes/landing/Features.tsx')).toContain('What your store comes with today');
		const band = source('/src/routes/landing/SellersBand.tsx');
		expect(band).toContain('SELLER_STORIES');
		expect(band).toContain('<SellerArt id={seller.id} />');
	});

	it('always underlines the Discover link under the build box', () => {
		const hero = source('/src/routes/landing/Hero.tsx');
		expect(hero).toMatch(/className="[^"]*\bunderline underline-offset-\[5px\][^"]*">\s*Browse stores in Discover/);
		expect(hero).not.toMatch(/hover:underline">\s*Browse stores in Discover/);
	});

	it('grows the builder demo to fill the window as the page scrolls', () => {
		const hero = source('/src/routes/landing/Hero.tsx');
		expect(hero).toContain('const { refs, sizes } = useScrollGrow();');
		// The stage pins right under the top bar; the track gives it room to stay pinned while it grows.
		expect(hero).toMatch(/ref=\{refs\.stage\}\s+className="sticky top-\[var\(--public-header-h\)\] /);
		expect(hero).toContain('style={sizes ? { height: sizes.track } : undefined}');
		expect(hero).toContain('style={sizes ? { height: sizes.stage } : undefined}');
		// At rest the card keeps the hero's width; the panel behind it is what reaches the window's edges.
		expect(hero).toMatch(/ref=\{refs\.card\}\s+className="relative mx-auto max-w-\[1152px\] /);
		expect(hero).toMatch(/ref=\{refs\.panel\}\s+aria-hidden/);
		expect(hero).not.toContain('max-w-[1392px]');
		expect(hero).toMatch(/ref=\{refs\.frame\}\s+role="img"/);
		expect(hero).toContain('origin-bottom');
	});

	it('scrolls the demo smoothly, and keeps it still for reduced motion or a window too short to show it', () => {
		const hook = source('/src/hooks/use-scroll-grow.ts');
		expect(hook).toContain('window.matchMedia(REDUCED_MOTION_QUERY)');
		expect(hook).toContain('canGrow(geometry)');
		expect(hook).toContain('requestAnimationFrame(apply)');
		expect(hook).toContain("addEventListener('scroll', schedule, { passive: true })");
		expect(hook).toContain('new ResizeObserver(measure)');
		expect(hook).not.toMatch(/framer/);
	});

	it('reserves the finished step list so the demo never grows while steps arrive', () => {
		expect(source('/src/routes/landing/Hero.tsx')).toMatch(/<AnimatedList [^>]*className="[^"]*min-h-28/);
	});

	it('shows Discover stores as wordmarks and as a showcase, and hides both at two stores or fewer', () => {
		expect(source('/src/routes/landing/LandingPage.tsx')).toContain('useShowcaseStores()');
		const logos = source('/src/routes/landing/StoreLogos.tsx');
		expect(logos).toContain('if (!shouldShowShowcase(stores.length)) return null;');
		expect(logos).toContain('<Marquee');
		const showcase = source('/src/routes/landing/StoreShowcase.tsx');
		expect(showcase).toContain('if (!shouldShowShowcase(withImages.length)) return null;');
		expect(showcase).toContain('<Marquee');
		expect(showcase).toContain("const activeFilter = filters.includes(filter) ? filter : 'all';");
		expect(showcase).toContain('aria-pressed={activeFilter === option}');
		expect(showcase).toContain('to={`/discover/${store.id}`}');
		expect(showcase).toContain('id="discover"');
		expect(showcase).toContain('See what people are building on Estori');
		expect(showcase).not.toMatch(/creators are building/);
	});

	it('keeps the hero and the showcase on one charcoal band, so no light seam shows between them', () => {
		const page = source('/src/routes/landing/LandingPage.tsx');
		expect(page).toMatch(/<div className="bg-public-charcoal">\s*<Hero stores=\{stores\} \/>\s*<StoreShowcase stores=\{stores\} \/>\s*<\/div>/);
	});

	it('shows the store names right under the build box, above the builder demo, inside the hero', () => {
		const hero = source('/src/routes/landing/Hero.tsx');
		const build = hero.indexOf('id="build"');
		const logos = hero.indexOf('<StoreLogos stores={stores} />');
		const demo = hero.indexOf('<BuilderDemo />');
		expect(build).toBeGreaterThan(-1);
		expect(logos).toBeGreaterThan(build);
		expect(demo).toBeGreaterThan(logos);
		expect(source('/src/routes/landing/LandingPage.tsx')).not.toContain('<StoreLogos');
		// Inside the charcoal hero, the strip has no background or divider of its own.
		expect(source('/src/routes/landing/StoreLogos.tsx')).not.toMatch(/<section[^>]*(bg-public-charcoal|border-b)/);
	});

	it('lays the page out in the approved order', () => {
		const page = source('/src/routes/landing/LandingPage.tsx');
		const order = [
			'<Hero stores={stores} />',
			'<StoreShowcase',
			'<AgenticCommerceSection />',
			'<AssistantsPanel />',
			'<PersonalizationSection />',
			'<Features />',
			'<SellersBand />',
			'<ClosingPanel />',
		];
		const positions = order.map((tag) => page.indexOf(tag));
		expect(positions.every((position) => position > -1)).toBe(true);
		expect([...positions].sort((a, b) => a - b)).toEqual(positions);
	});

	it('leaves pricing and the questions to the pricing page', () => {
		const page = source('/src/routes/landing/LandingPage.tsx');
		expect(page).not.toContain('<PricingSummary');
		expect(page).not.toContain('<PublicFaq');
		expect(source('/src/routes/landing/sections.tsx')).not.toContain('export function PricingSummary');
	});

	it('uses the 1Password layout: charcoal features, and a light blue closing panel with a laptop on a cloud', () => {
		expect(source('/src/routes/landing/Features.tsx')).toContain('bg-public-charcoal');
		const sections = source('/src/routes/landing/sections.tsx');
		const closing = sections.slice(sections.indexOf('export function ClosingPanel'));
		expect(closing).toContain('rounded-[25px] bg-[#dce9fc]');
		expect(closing).toContain('<CloudLaptop />');
		expect(closing).toContain('Your next store starts with a sentence.');
		expect(closing).toContain('Start building free');
		expect(source('/src/components/public-site/CloudLaptop.tsx')).toMatch(/^\s*<svg aria-hidden /m);
	});

	it('closes with our own words, not a customer review we do not have', () => {
		const sections = source('/src/routes/landing/sections.tsx');
		const closing = sections.slice(sections.indexOf('export function ClosingPanel'));
		expect(closing).not.toMatch(/[\u201c\u201d]|review|<blockquote/i);
	});

	it('has no live preview section', () => {
		expect(source('/src/routes/landing/LandingPage.tsx')).not.toContain('LivePreview');
		expect(Object.keys(pageSources)).not.toContain('/src/routes/landing/LivePreview.tsx');
	});

	it('lets keyboard users reach every store in the marquees once, in view and with a visible focus ring', () => {
		const logos = source('/src/routes/landing/StoreLogos.tsx');
		const showcase = source('/src/routes/landing/StoreShowcase.tsx');
		// The edge fades hide while a link inside their wrapper has focus.
		expect(source('/src/components/public-site/primitives.tsx').match(/transition-opacity group-focus-within\/edges:opacity-0/g)).toHaveLength(2);
		expect(logos).toContain('<div className="group/edges relative mt-8">');
		expect(showcase).toContain('<div className="group/edges relative mt-12">');
		// Room above and below each row for the focus rings.
		for (const text of [logos, showcase]) {
			expect(text).not.toMatch(/<Marquee[^>]*className="p-0 /);
			expect(text).toMatch(/<Marquee[^>]*className="px-0 py-1 /);
		}
		// The reverse row repeats the first, so it stays out of the accessibility tree and the tab order.
		const rowTwo = showcase.slice(showcase.indexOf('<Marquee pauseOnHover reverse'), showcase.indexOf('</Marquee>', showcase.indexOf('<Marquee pauseOnHover reverse')));
		expect(rowTwo).toMatch(/<Marquee pauseOnHover reverse aria-hidden /);
		expect(rowTwo).toContain('focusable={false}');
		expect(showcase).toContain('focusable = true');
		expect(showcase).toContain('tabIndex={focusable ? undefined : -1}');
		expect(showcase).not.toContain('inert');
	});

	it('keeps a card readable when its image fails to load', () => {
		const showcase = source('/src/routes/landing/StoreShowcase.tsx');
		expect(showcase).toContain('onError={() => setFailedImage(store.imageUrl)}');
		expect(showcase).toContain('failedImage !== store.imageUrl');
	});

	it('shows no third-party company logos or testimonials', () => {
		expect(landing).not.toMatch(/trusted by/i);
		expect(landing).not.toContain('/img/logos/');
		expect(landing).not.toMatch(/case study/i);
	});

	it("doesn't promise store payments, and states the seller fee from the code", () => {
		expect(landing).toContain('<ComingSoon');
		expect(landing).toContain('PLATFORM_FEE_LABEL');
		expect(landing).not.toMatch(/7% \+ \$0\.60/);
	});

	it('names no competitor', () => {
		const copy = (landing + source('/src/routes/pricing.tsx')).toLowerCase();
		for (const name of COMPETITORS) expect(copy).not.toContain(name);
	});

	it("hides Safari's default disclosure marker on the FAQ questions", () => {
		const summary = landing.slice(landing.indexOf('<summary'), landing.indexOf('>', landing.indexOf('<summary')));
		expect(summary).toContain('list-none');
		expect(summary).toContain('[&::-webkit-details-marker]:hidden');
	});

	it('answers the launch questions', () => {
		for (const question of [
			'Is Estori free?',
			'What does Coming soon mean?',
			'Can my store take payments?',
			'Does Estori take a cut of my store sales?',
			'Who owns the store I build?',
			'What does Estori charge for template sales?',
			'Can I resell a store I bought?',
			"What if a store I bought doesn't work?",
		]) {
			expect(landing).toContain(question);
		}
	});
});
