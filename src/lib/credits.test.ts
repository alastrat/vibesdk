import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from './capabilities';
import { CREDIT_ACTIONS, DAYS_PER_MONTH, actionCredits, actionCreditsRange, creditsFor, monthlyCredits, recommendPlan, typicalUsage, type Usage } from './credits';
import { PREMIUM_TIERS } from './plans';

/** Claude Sonnet 5.5's rate, the builder's default today. */
const DEFAULT_RATE = 8;

const USAGE: Usage = {
	creditsPerStep: DEFAULT_RATE,
	stores: 2,
	categories: { build: true, change: true, assistant: false, personalization: false },
	newStores: 3,
	changesPerStore: 40,
	assistantTasksPerStore: 100,
	visitsPerStore: 5_000,
};

function action(id: string) {
	const found = CREDIT_ACTIONS.find((entry) => entry.id === id);
	if (!found) throw new Error(id);
	return found;
}

describe('credits', () => {
	it('prices building and changing by AI steps at the model rate, and the coming-soon actions at a fixed cost', () => {
		expect(CREDIT_ACTIONS.map((entry) => entry.id)).toEqual(['build', 'change', 'assistant', 'personalization']);
		expect(actionCredits(action('build'), DEFAULT_RATE)).toBe(action('build').steps! * DEFAULT_RATE);
		expect(actionCredits(action('change'), 3)).toBe(action('change').steps! * 3);
		expect(actionCredits(action('assistant'), DEFAULT_RATE)).toBe(actionCredits(action('assistant'), 16));
		for (const entry of CREDIT_ACTIONS) {
			expect(actionCredits(entry, DEFAULT_RATE), entry.id).toBeGreaterThan(0);
			if (entry.capability) expect(CAPABILITIES[entry.capability].status, entry.id).not.toBe('available');
		}
	});

	it('gives the range across the models a visitor can pick', () => {
		expect(actionCreditsRange(action('build'), [3, 8, 16])).toEqual({ min: action('build').steps! * 3, max: action('build').steps! * 16 });
		expect(actionCreditsRange(action('assistant'), [3, 8, 16])).toEqual({ min: action('assistant').credits!, max: action('assistant').credits! });
	});

	it('works out each category from its own inputs', () => {
		expect(creditsFor('build', USAGE)).toBe(3 * actionCredits(action('build'), DEFAULT_RATE));
		expect(creditsFor('change', USAGE)).toBe(2 * 40 * actionCredits(action('change'), DEFAULT_RATE));
		expect(creditsFor('assistant', USAGE)).toBe(2 * 100 * action('assistant').credits!);
		// Personalization is priced per thousand shopper visits.
		expect(creditsFor('personalization', USAGE)).toBe(2 * 5 * action('personalization').credits!);
	});

	it('adds up only the categories that are switched on', () => {
		expect(monthlyCredits(USAGE)).toBe(creditsFor('build', USAGE) + creditsFor('change', USAGE));
		expect(monthlyCredits({ ...USAGE, categories: { build: false, change: false, assistant: false, personalization: false } })).toBe(0);
	});

	it('costs less with a lighter model', () => {
		expect(monthlyCredits({ ...USAGE, creditsPerStep: 3 })).toBeLessThan(monthlyCredits(USAGE));
	});

	it('suggests typical amounts that grow with the number of stores', () => {
		expect(typicalUsage(1, DEFAULT_RATE).stores).toBe(1);
		expect(monthlyCredits(typicalUsage(5, DEFAULT_RATE))).toBeGreaterThan(monthlyCredits(typicalUsage(1, DEFAULT_RATE)));
		expect(typicalUsage(0, DEFAULT_RATE).stores).toBe(1);
	});

	it('recommends Basic while the free daily allowance covers the month', () => {
		const free = 200 * DAYS_PER_MONTH;
		expect(recommendPlan(free, free)).toEqual({ plan: 'basic' });
		expect(recommendPlan(0, free)).toEqual({ plan: 'basic' });
	});

	it('recommends the smallest Premium pool past the free allowance, and Enterprise past the largest', () => {
		const free = 200 * DAYS_PER_MONTH;
		expect(recommendPlan(free + 1, free)).toEqual({ plan: 'premium', tier: PREMIUM_TIERS[0] });
		expect(recommendPlan(PREMIUM_TIERS[1].credits, free)).toEqual({ plan: 'premium', tier: PREMIUM_TIERS[1] });
		expect(recommendPlan(PREMIUM_TIERS[PREMIUM_TIERS.length - 1].credits + 1, free)).toEqual({ plan: 'enterprise' });
	});

	it("doesn't recommend Basic when the free allowance isn't known", () => {
		expect(recommendPlan(10, null)).toEqual({ plan: 'premium', tier: PREMIUM_TIERS[0] });
	});
});
