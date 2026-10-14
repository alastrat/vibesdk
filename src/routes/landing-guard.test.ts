import { describe, expect, it } from 'vitest';
import { COMPETITORS } from './copy-rules';

const pageSources = import.meta.glob<string>(['/src/routes/landing/*.tsx', '/src/components/public-site/*.tsx'], {
	query: '?raw',
	import: 'default',
	eager: true,
});
const otherSources = import.meta.glob<string>(
	['/src/routes/root-index.tsx', '/src/routes/pricing.tsx', '/src/components/build-box.tsx', '/src/routes/home.tsx', '/src/routes.tsx'],
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

	it('always underlines the Discover link under the build box', () => {
		const hero = source('/src/routes/landing/Hero.tsx');
		expect(hero).toMatch(/className="[^"]*\bunderline underline-offset-\[5px\][^"]*">\s*Browse stores in Discover/);
		expect(hero).not.toMatch(/hover:underline">\s*Browse stores in Discover/);
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
	});

	it('lays the page out in the approved order', () => {
		const page = source('/src/routes/landing/LandingPage.tsx');
		const order = ['<Hero />', '<StoreLogos', '<StoreShowcase', '<Features />', '<CreatorsPanel />', '<LivePreview />', '<PricingSummary />', '<PublicFaq />', '<ClosingPanel />'];
		const positions = order.map((tag) => page.indexOf(tag));
		expect(positions.every((position) => position > -1)).toBe(true);
		expect([...positions].sort((a, b) => a - b)).toEqual(positions);
	});

	it('uses the 1Password layout: charcoal features and a charcoal closing panel', () => {
		expect(source('/src/routes/landing/Features.tsx')).toContain('bg-public-charcoal');
		const sections = source('/src/routes/landing/sections.tsx');
		expect(sections.slice(sections.indexOf('export function ClosingPanel'))).toContain('bg-public-charcoal');
	});

	it('shows the live preview on bundled desktop and phone images', () => {
		const preview = source('/src/routes/landing/LivePreview.tsx');
		expect(preview).toContain("'/marketing/preview-desktop.jpg'");
		expect(preview).toContain("'/marketing/preview-phone.jpg'");
		expect(preview).toContain('<Safari');
		expect(preview).toContain('<Iphone');
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
