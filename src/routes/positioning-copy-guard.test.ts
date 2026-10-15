import { describe, expect, it } from 'vitest';
import { BRAND } from '@/brand';
import { AI_ASSISTANT_NAMES, COMPETITORS } from './copy-rules';

const pages = import.meta.glob<string>(
	[
		'/src/routes/landing/*.tsx',
		'/src/routes/solutions/*.tsx',
		'/src/routes/creators/*.tsx',
		'/src/routes/agentic-commerce.tsx',
		'/src/routes/pricing.tsx',
		'/src/components/public-site/*.tsx',
		'/src/components/layout/PublicTopBar.tsx',
		'/src/components/layout/NavMenu.tsx',
		'/src/components/layout/SiteFooter.tsx',
		'/src/content/positioning.ts',
		'/src/lib/site-nav.ts',
		'/src/lib/capabilities.ts',
		'/src/lib/plans.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

const all = Object.values(pages).join('\n');

describe('positioning copy rules', () => {
	it('names no competitor and no AI assistant or its maker', () => {
		const lower = all.toLowerCase();
		for (const name of [...COMPETITORS, ...AI_ASSISTANT_NAMES]) expect(lower, name).not.toContain(name);
	});

	it('names the standards only as the open agentic commerce standards, never as "the standard"', () => {
		const mentions = all.match(/UCP and ACP/g) ?? [];
		const proper = all.match(/open agentic commerce standards \(UCP and ACP\)/g) ?? [];
		expect(mentions.length).toBeGreaterThan(0);
		expect(proper.length).toBe(mentions.length);
		expect(all).not.toMatch(/\bthe (agentic commerce )?standard\b/i);
	});

	it('describes the site in plain words with the new positioning, which is what shared links preview', () => {
		expect(BRAND.description).toContain('Estori builds it in minutes');
		expect(BRAND.description).not.toMatch(/templates|agentic/i);
	});

	it('explains AI recommendations in plain words, keeping the standards for the explainer page', () => {
		const copy = pages['/src/content/positioning.ts'];
		const summary = copy.slice(copy.indexOf('export const AGENTIC_COMMERCE_SUMMARY'), copy.indexOf(';', copy.indexOf('export const AGENTIC_COMMERCE_SUMMARY')));
		expect(summary).toContain('ask AI assistants');
		expect(summary).not.toMatch(/UCP|ACP|agentic/);
		expect(copy).toContain('open agentic commerce standards (UCP and ACP)');
	});

	it("names capabilities the way a store owner would say them", () => {
		const capabilities = pages['/src/lib/capabilities.ts'];
		expect(capabilities).toContain("name: 'Get found by AI assistants'");
		expect(capabilities).toContain("name: 'Store assistants'");
		expect(capabilities).not.toMatch(/name: '(Agentic commerce|Operations agents)'/);
	});
});
