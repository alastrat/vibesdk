import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/src/routes/solutions/*.tsx', '/src/routes/agentic-commerce.tsx', '/src/routes/creators/*.tsx', '/src/routes.tsx'],
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
		for (const path of ["path: 'solutions/brands'", "path: 'solutions/resellers'", "path: 'solutions/digital'", "path: 'agentic-commerce'"]) {
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

	it('give the menu links their anchors', () => {
		const brands = source('/src/routes/solutions/brands.tsx');
		expect(brands).toContain('<OperationsSection id="operations" />');
		expect(brands).toContain('<PersonalizationSection id="personalization" />');
		expect(source('/src/routes/solutions/resellers.tsx')).toContain('id="catalog"');
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

	it('takes early-access requests for the content creator program, including after a sign-in that reloads the page', () => {
		const content = source('/src/routes/creators/content.tsx');
		expect(content).toContain('<EarlyAccessButton capability="content-creators"');
		expect(content).toContain('useEarlyAccessFromUrl();');
		expect(content).not.toContain('<ComingSoon');
	});
});
