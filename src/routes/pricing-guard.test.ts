import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes/pricing.tsx',
		'/src/routes.tsx',
		'/src/components/pricing/*.tsx',
		'/src/components/marketing/PlanLimits.tsx',
		'/src/content/positioning.ts',
		'/src/components/public-site/PublicFaq.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

const CARDS = '/src/components/pricing/PlanCards.tsx';
const COMPARE = '/src/components/pricing/ComparePlans.tsx';
const CREDITS = '/src/components/pricing/CreditsExplainer.tsx';

describe('pricing page', () => {
	const page = source('/src/routes/pricing.tsx');

	it("answers questions in 1Password's FAQ: a lavender panel, a big heading, and two columns of plus and minus rows", () => {
		const faq = source('/src/components/public-site/PublicFaq.tsx');
		expect(faq).toContain('Frequently asked questions');
		expect(faq).toContain('rounded-[25px] bg-[#e4e8f8]');
		expect(faq).toContain('lg:grid-cols-2');
		// Down the left column, then the right, so reading order matches what people see.
		expect(faq).toContain('const columns = [questions.slice(0, half), questions.slice(half)];');
		expect(faq).toContain('<PlusIcon');
		expect(faq).toContain('group-open:hidden');
		expect(faq).toContain('<MinusIcon');
		expect(faq).toContain('group-open:block');
	});

	it('lays out the plans, Enterprise, the comparison, credits, template selling and the questions, in that order', () => {
		const order = ['<PlanCards />', '<ComparePlans />', '<CreditsExplainer />', 'id="developers"', '<PublicFaq leading={PRICING_FAQ} />'];
		const positions = order.map((tag) => page.indexOf(tag));
		expect(positions.every((position) => position > -1)).toBe(true);
		expect([...positions].sort((a, b) => a - b)).toEqual(positions);
	});

	it('shows Basic and Premium side by side in one frame, with Enterprise on its own band', () => {
		const cards = source(CARDS);
		expect(cards).toContain('md:grid-cols-2');
		expect(cards).toContain('<BasicPlan />');
		expect(cards).toContain('<PremiumPlan />');
		expect(cards).toContain('<EnterpriseBand />');
	});

	it('states the free allowance from the live limits, never typed in', () => {
		const cards = source(CARDS);
		expect(cards).toContain('<PlanLimits');
		expect(cards).not.toMatch(/200 (AI )?credits/);
		expect(source('/src/components/marketing/PlanLimits.tsx')).toContain('fallback');
	});

	it('lets visitors pick a Premium credit pool, with the price following it', () => {
		const cards = source(CARDS);
		expect(cards).toContain('PREMIUM_TIERS.map');
		expect(cards).toContain('<Price cents={tier.priceCents} />');
		expect(cards).not.toMatch(/\$(99|199|349|599)\b/);
	});

	it("doesn't sell Premium before subscriptions exist: it leads to sales with the chosen pool, marked coming soon", () => {
		const cards = source(CARDS);
		expect(cards).toContain("contactPath('premium', tier.credits)");
		expect(cards).toContain('<ComingSoon />');
		expect(cards).toContain('Paid plans are coming soon');
		expect(cards).not.toMatch(/Buy now|Subscribe|checkout/i);
	});

	it('sends Enterprise to sales, without a public price', () => {
		const cards = source(CARDS);
		const band = cards.slice(cards.indexOf('function EnterpriseBand'));
		expect(band).toContain("contactPath('enterprise')");
		expect(band).toContain('Talk to sales');
		expect(band).not.toMatch(/\$\d/);
	});

	it('shows phones one plan beside the labels, picked from the corner of the header', () => {
		const compare = source(COMPARE);
		expect(compare).toContain('const isPhone = useIsMobile();');
		expect(compare).toContain('const shown = isPhone ? PLANS.filter((entry) => entry.id === phonePlan) : PLANS;');
		expect(compare).toContain('colSpan={shown.length + 1}');
		expect(compare).toMatch(/<select[^>]*aria-label="Plan to compare"/);
	});

	it('puts the Compare plans heading in the corner of the pinned header, beside the plans, on every screen', () => {
		const compare = source(COMPARE);
		const corner = compare.slice(compare.indexOf('<thead>'), compare.indexOf('{shown.map'));
		expect(corner).toContain('<h2 id="compare-title"');
		expect(compare.match(/<h2/g)).toHaveLength(1);
		// The phone plan picker sits under it, in the same cell.
		expect(corner.indexOf('<h2')).toBeLessThan(corner.indexOf('aria-label="Plan to compare"'));
	});

	it('compares plans with pinned headers, and groups that fold', () => {
		const compare = source(COMPARE);
		expect(compare).toContain('PLAN_COMPARISON.map');
		expect(compare).toContain('sticky top-[var(--public-header-h)] z-10');
		// No scrolling box around the table at any width: it would stop the headers from pinning to the page.
		expect(compare).not.toContain('overflow-x-auto');
		expect(compare).not.toContain('min-w-[');
		expect(compare).toContain('aria-expanded={!isFolded}');
		expect(compare).toContain('<CapabilityTag id={section.capability} />');
		expect(compare).toContain('<caption className="sr-only">What each plan includes</caption>');
		expect(compare).toContain('<span className="sr-only">, {note}</span>');
	});

	it('explains credits from the same table the calculator uses, and links to the calculator', () => {
		const credits = source(CREDITS);
		expect(credits).toContain('CREDIT_ACTIONS.map');
		expect(credits).toContain('actionCreditsRange(');
		expect(credits).toContain('to="/pricing/calculator"');
		expect(credits).toContain('Calculate my credit needs');
	});

	it('keeps template selling, with the fee from the code', () => {
		expect(page).toContain('PLATFORM_FEE_LABEL');
		expect(page).toContain('sellerKeepsTable()');
		expect(page).not.toMatch(/7% \+ \$0\.60/);
		expect(page).toContain('<caption className="sr-only">What a seller keeps at each price</caption>');
	});

	it('answers the credit questions', () => {
		const copy = source('/src/content/positioning.ts');
		for (const question of ['What are AI credits?', 'What happens when I run out of credits?', 'Can I change my Premium credits?', 'Is Premium available now?']) {
			expect(copy, question).toContain(question);
		}
	});

	it('is a public page, with the calculator beside it', () => {
		const routes = source('/src/routes.tsx');
		const publicRoutes = routes.slice(routes.indexOf('Component: PublicShell'));
		expect(publicRoutes).toContain("path: 'pricing'");
		expect(publicRoutes).toContain("path: 'pricing/calculator'");
		expect(page).not.toContain('kumo-');
	});
});
