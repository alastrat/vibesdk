import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/routes.tsx', '/src/routes/industries/IndustryPage.tsx', '/src/components/layout/NavMenu.tsx'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('industry pages', () => {
	it('has a page per industry in the public site', () => {
		expect(source('/src/routes.tsx')).toMatch(/path: 'industries\/:slug',\s*Component: IndustryPage,/);
	});

	it('uses the solution page template, with example requests and what the stores can include', () => {
		const page = source('/src/routes/industries/IndustryPage.tsx');
		for (const part of ['<SolutionHero', 'industry.prompts.map', 'cards={industry.features}', 'cards={TODAY_CARDS}', '<HowItWorks', '<ClosingPanel']) {
			expect(page, part).toContain(part);
		}
		expect(page).toContain("We couldn't find that industry");
	});

	it('lists the industries second in the Solutions menu, in place of Get started', () => {
		const nav = source('/src/components/layout/NavMenu.tsx');
		const solutions = nav.slice(nav.indexOf('<Column title="Estori for"'));
		expect(solutions.indexOf('<Column title="Industries"')).toBeGreaterThan(0);
		expect(solutions.indexOf('<Column title="Industries"')).toBeLessThan(solutions.indexOf('<Column title="Platform"'));
		expect(nav).toContain('INDUSTRIES.map');
		expect(nav).not.toMatch(/solutions: \{\s*links:/);
	});
});
