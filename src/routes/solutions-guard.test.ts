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
