import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/routes/pricing.tsx', '/src/routes.tsx', '/src/routes/landing/sections.tsx'], {
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

	it('shows the four plans from the plan data, never typed-in prices', () => {
		expect(page).toContain('PLANS.map');
		expect(page).toContain('<PlanPrice');
		expect(page).not.toMatch(/\$(29|79|249)\b/);
		expect(page).not.toMatch(/10,000|30,000|100,000/);
	});

	it('offers a button only on plans available today', () => {
		const card = page.slice(page.indexOf('function PlanCard('), page.indexOf('function Cell('));
		expect(card.match(/<PillLink/g)).toHaveLength(1);
		expect(card.indexOf('<PillLink')).toBeGreaterThan(card.indexOf("plan.status === 'available' && ("));
		expect(card).toContain("plan.status === 'coming-soon' && <ComingSoon />");
		expect(page).not.toMatch(/Subscribe|Upgrade/);
	});

	it('compares plans by capability, with tags from the registry', () => {
		expect(page).toContain('PLAN_COMPARISON.map');
		expect(page).toContain('<CapabilityTag id={section.capability} />');
		expect(page).toContain('<caption className="sr-only">What each plan includes</caption>');
	});

	it("tells screen readers each row's status, not only the section heading", () => {
		expect(page).toContain('scope="rowgroup"');
		expect(page).not.toContain('scope="colgroup"');
		expect(page).toContain('STATUS_LABELS[');
		expect(page).toContain('<span className="sr-only">, {note}</span>');
	});

	it('states the free limits and the template fee from the code that applies them', () => {
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
		expect(page).toContain('Accept payments in your store');
	});

	it('keeps template selling in its own section that the developer page links to', () => {
		expect(page).toContain('id="developers"');
		expect(page).toContain('<caption className="sr-only">What a seller keeps at each price</caption>');
		const sell = page.slice(page.lastIndexOf('<article', page.indexOf('>Sell</h3>')), page.indexOf('>Sell</h3>'));
		expect(sell).toMatch(/<article className=\{cn\(CARD, '[^']*\brelative\b/);
	});

	it('is a public page in the 1Password layout', () => {
		const routes = source('/src/routes.tsx');
		expect(routes.slice(routes.indexOf('Component: PublicShell'))).toContain("path: 'pricing'");
		expect(page).toContain('bg-public-charcoal');
		expect(page).toContain('<PublicFaq />');
		expect(page).not.toContain('kumo-');
	});
});

describe('landing pricing summary', () => {
	it('shows the same plans from the same data', () => {
		const sections = source('/src/routes/landing/sections.tsx');
		const summary = sections.slice(sections.indexOf('export function PricingSummary'), sections.indexOf('export function ClosingPanel'));
		expect(summary).toContain('PLANS.map');
		expect(summary).toContain('<PlanPrice');
		expect(summary).toContain('<ComingSoon />');
	});
});
