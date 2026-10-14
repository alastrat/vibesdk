import { describe, expect, it } from 'vitest';
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

	it('states the explainer copy for agentic commerce in one place', () => {
		const copy = pages['/src/content/positioning.ts'];
		expect(copy).toContain('export const AGENTIC_COMMERCE_SUMMARY');
		expect(copy).toContain('open agentic commerce standards (UCP and ACP)');
	});
});
