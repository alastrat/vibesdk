import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/routes/pricing.tsx', '/src/routes.tsx'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('pricing page', () => {
	const page = source('/src/routes/pricing.tsx');

	it('states the fee and limits from the code that applies them', () => {
		expect(page).toContain('PLATFORM_FEE_LABEL');
		expect(page).toContain('sellerKeepsTable()');
		expect(page).toContain('<PlanLimits');
		expect(page).not.toMatch(/7% \+ \$0\.60/);
	});

	it("doesn't promise store payments yet", () => {
		expect(page).toContain('<ComingSoon');
		expect(page).toContain('Accept payments in your store');
	});

	it('is a public page', () => {
		const routes = source('/src/routes.tsx');
		expect(routes.slice(routes.indexOf('Component: PublicShell'))).toContain("path: 'pricing'");
	});
});
