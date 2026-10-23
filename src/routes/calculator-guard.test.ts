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

	it("prices AI work at live model rates and Basic at its configured monthly allowance", () => {
		const calculator = source(CALCULATOR);
		expect(calculator).toContain('useModelRates()');
		expect(calculator).toContain('const basicCredits = PLAN_LIMITS.basic.aiCredits;');
		expect(calculator).not.toContain('aiCreditsPerDay');
		expect(calculator).not.toContain('visitsPerStore');
		expect(calculator).toContain('marketingCopy.pricing.credits.calculatorNote');
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
		expect(calculator).toContain('<StartBuildingButton variant="blue" />');
		expect(calculator).toContain("contactPath(recommendation.plan, needed)");
		expect(calculator).toContain('<PlanButton i18n={publicTranslator()} plan={recommendation.plan} />');
		expect(calculator).toContain('recommendPlan(needed)');
		expect(calculator).toContain("contactPath('enterprise')");
		expect(calculator).toContain('to="/pricing#compare"');
	});

	it('prices Premium with the extra credits a bigger month needs, from the extra-credits table', () => {
		const calculator = source(CALCULATOR);
		expect(calculator).toContain('PLAN_PRICES_CENTS.premium + extraCreditsPriceCents(recommendation.extraCredits)');
		expect(calculator).toContain('extra credits (');
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

	it('waits for model rates before recommending from the configured monthly allowances', () => {
		const calculator = source(CALCULATOR);
		expect(calculator).toContain('const ready = models.length > 0;');
		expect(calculator).toContain('Working out your plan');
		// One source for plan names and actions.
		expect(calculator).not.toContain('RECOMMENDED_NAMES');
		expect(calculator).not.toContain('CREDIT_ACTIONS.find');
	});

	it('lets a number be cleared and retyped, and settles it when the field is left', () => {
		const stepper = source('/src/components/pricing/Stepper.tsx');
		expect(stepper).toContain('const [draft, setDraft] = useState<string | null>(null);');
		expect(stepper).toContain('value={draft ?? value}');
		expect(stepper).toContain('onBlur={');
	});

	it('uses labelled steppers that keep values in range', () => {
		const stepper = source('/src/components/pricing/Stepper.tsx');
		expect(stepper).toContain("aria-label={t('Fewer {items}', { items: noun })}");
		expect(stepper).toContain("aria-label={t('More {items}', { items: noun })}");
		expect(stepper).toContain('Math.min(max, Math.max(min');
		expect(stepper).toContain('<label htmlFor={id}');
	});

	it('is its own page with a title', () => {
		const page = source('/src/routes/pricing-calculator.tsx');
		expect(page).toContain('<PageMeta');
		expect(page).toContain('<Calculator />');
	});
});
