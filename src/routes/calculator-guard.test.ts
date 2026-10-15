import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/routes/pricing-calculator.tsx', '/src/components/pricing/Calculator.tsx', '/src/components/pricing/Stepper.tsx'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

const CALCULATOR = '/src/components/pricing/Calculator.tsx';

describe('credits calculator', () => {
	it('works out the month from the same credit table and recommends a plan, as on Apollo', () => {
		const calculator = source(CALCULATOR);
		for (const call of ['typicalUsage(', 'monthlyCredits(', 'creditsFor(', 'recommendPlan(', 'CREDIT_ACTIONS.map']) expect(calculator, call).toContain(call);
	});

	it("prices the AI's steps at the live model rates, and Basic at the live daily allowance", () => {
		const calculator = source(CALCULATOR);
		expect(calculator).toContain('useModelRates()');
		expect(calculator).toContain('usePublicPlan()');
		expect(calculator).toContain('aiCreditsPerDay * DAYS_PER_MONTH');
	});

	it('starts from typical amounts for the number of stores, and can start over', () => {
		const calculator = source(CALCULATOR);
		expect(calculator).toContain('These are typical amounts for');
		expect(calculator).toContain('Start over');
	});

	it('keeps the recommendation pinned beside the inputs on wide screens, and announces it', () => {
		const calculator = source(CALCULATOR);
		expect(calculator).toContain('lg:sticky lg:top-[calc(var(--public-header-h)+1.5rem)]');
		expect(calculator).toContain('aria-live="polite"');
	});

	it('sends each recommendation to its next step: build, Premium with the pool, or sales', () => {
		const calculator = source(CALCULATOR);
		expect(calculator).toContain('to="/#build"');
		expect(calculator).toContain("contactPath('premium', recommendation.tier.credits)");
		expect(calculator).toContain("contactPath('enterprise')");
		expect(calculator).toContain('to="/pricing#compare"');
	});

	it('keeps the recommendation in sight on phones, pinned under the inputs until the panel comes into view', () => {
		const calculator = source(CALCULATOR);
		const bar = calculator.slice(calculator.indexOf('{/* Phone summary'), calculator.indexOf('<aside'));
		expect(bar).toContain('sticky bottom-0');
		expect(bar).toContain('lg:hidden');
		expect(bar).toContain('{planPrice(recommendation)}');
		expect(bar).toContain('recommendationRef.current?.scrollIntoView(');
		expect(calculator).toMatch(/<aside ref=\{recommendationRef\}/);
	});

	it('uses labelled steppers that keep values in range', () => {
		const stepper = source('/src/components/pricing/Stepper.tsx');
		expect(stepper).toContain('aria-label={`Fewer ${noun}`}');
		expect(stepper).toContain('aria-label={`More ${noun}`}');
		expect(stepper).toContain('Math.min(max, Math.max(min');
		expect(stepper).toContain('<label htmlFor={id}');
	});

	it('is its own page with a title', () => {
		const page = source('/src/routes/pricing-calculator.tsx');
		expect(page).toContain('<PageMeta');
		expect(page).toContain('<Calculator />');
	});
});
