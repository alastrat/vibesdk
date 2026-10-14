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

	it('explains that models use credits at different rates', () => {
		expect(page).toContain('Each model uses credits at its own rate, so lighter models go further.');
		expect(page).toContain('usePublicPlan()');
		expect(page).toContain('aiCreditsPerDay == null');
	});

	it("doesn't promise store payments yet", () => {
		expect(page).toContain('<ComingSoon');
		expect(page).toContain('Accept payments in your store');
	});

	it('is a public page', () => {
		const routes = source('/src/routes.tsx');
		expect(routes.slice(routes.indexOf('Component: PublicShell'))).toContain("path: 'pricing'");
	});

	it('uses the 1Password layout: charcoal hero, white plan cards, the shared FAQ', () => {
		expect(page).toContain('bg-public-charcoal');
		expect(page).toContain('<PublicFaq />');
		expect(page).not.toContain('kumo-');
	});

	it('keeps the seller table readable by screen readers', () => {
		expect(page).toContain('<caption className="sr-only">What a seller keeps at each price</caption>');
		expect(page.match(/scope="col"/g)).toHaveLength(3);
	});

	it('positions the Sell card, so the absolute sr-only caption cannot add a second page scroll', () => {
		const sell = page.slice(page.lastIndexOf('<article', page.indexOf('>Sell</h2>')), page.indexOf('>Sell</h2>'));
		expect(sell).toMatch(/<article className=\{cn\(CARD, '[^']*\brelative\b/);
		expect(sell.length).toBeLessThan(200);
	});
});
