import { describe, expect, it } from 'vitest';

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

const COMPETITORS = ['lovable', 'base44', 'amboras', 'shopify', 'wix', 'squarespace', 'webflow', 'framer', 'bolt.new', 'replit', 'v0.dev', 'durable.co'];

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

	it('states what a seller keeps from the fee code, with the creators anchor the top bar links to', () => {
		const creators = source('/src/routes/landing/CreatorsPanel.tsx');
		expect(creators).toContain('sellerKeepsCents(EXAMPLE_SALE_CENTS)');
		expect(creators).toContain('<AnimatedBeam');
		expect(creators).toContain('id="creators"');
		expect(creators).not.toContain('26.37');
	});

	it('uses the 1Password layout: charcoal features, a blue creators panel and a charcoal closing panel', () => {
		expect(source('/src/routes/landing/Features.tsx')).toContain('bg-public-charcoal');
		expect(source('/src/routes/landing/CreatorsPanel.tsx')).toContain('bg-public-blue');
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

	it('keeps a card readable when its image fails to load', () => {
		expect(source('/src/routes/landing/StoreShowcase.tsx')).toContain('onError={() => setImageFailed(true)}');
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

	it('answers the six launch questions', () => {
		for (const question of [
			'Is Estori free?',
			'Can my store take payments?',
			'Who owns the store I build?',
			'Can I resell a store I bought?',
			'What does Estori charge sellers?',
			"What if a store I bought doesn't work?",
		]) {
			expect(landing).toContain(question);
		}
	});
});
