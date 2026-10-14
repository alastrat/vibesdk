import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes/root-index.tsx',
		'/src/routes/landing/LandingPage.tsx',
		'/src/routes/landing/sections.tsx',
		'/src/routes/pricing.tsx',
		'/src/components/build-box.tsx',
		'/src/routes/home.tsx',
		'/src/routes.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

const COMPETITORS = ['lovable', 'base44', 'amboras', 'shopify', 'wix', 'squarespace', 'webflow', 'framer', 'bolt.new', 'replit', 'v0.dev', 'durable.co'];

describe('landing page', () => {
	const landing = source('/src/routes/landing/LandingPage.tsx') + source('/src/routes/landing/sections.tsx');

	it('shows the landing page signed out and the builder home signed in, with a loader in between', () => {
		const root = source('/src/routes/root-index.tsx');
		expect(root).toContain('isLoading');
		expect(root).toContain('<LandingPage />');
		expect(root).toContain('<Home />');
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

	it('hides the featured stores section when Discover has none', () => {
		expect(landing).toContain('useDiscoverStripSites()');
		expect(landing).toContain('if (!sites.data?.length) return null;');
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
