import { describe, expect, it } from 'vitest';
import { LEGACY_CREDIT_FACTOR } from '@/api-types';
import { CAPABILITIES } from './capabilities';
import {
	CREDIT_ACTIONS,
	DAYS_PER_MONTH,
	actionById,
	actionCredits,
	actionCreditsRange,
	creditsFor,
	monthlyCredits,
	recommendPlan,
	typicalUsage,
	type Usage,
} from './credits';

/** Claude Sonnet 5.5's typical credits per step, the builder's default. */
const DEFAULT_RATE = 136;

const USAGE: Usage = {
	creditsPerStep: DEFAULT_RATE,
	stores: 2,
	categories: { build: true, change: true, assistant: false },
	newStores: 3,
	changesPerStore: 40,
	assistantTasksPerStore: 100,
};

function action(id: string) {
	const found = CREDIT_ACTIONS.find((entry) => entry.id === id);
	if (!found) throw new Error(id);
	return found;
}

describe('credits', () => {
	it('prices building and changing by AI steps at the model rate, and the coming-soon actions at a fixed cost', () => {
		expect(CREDIT_ACTIONS.map((entry) => entry.id)).toEqual(['build', 'change', 'assistant']);
		expect(actionCredits(action('build'), DEFAULT_RATE)).toBe(action('build').steps! * DEFAULT_RATE);
		expect(actionCredits(action('change'), 16)).toBe(action('change').steps! * 16);
		expect(actionCredits(action('assistant'), DEFAULT_RATE)).toBe(actionCredits(action('assistant'), 445));
		for (const entry of CREDIT_ACTIONS) {
			expect(actionCredits(entry, DEFAULT_RATE), entry.id).toBeGreaterThan(0);
			if (entry.capability) expect(CAPABILITIES[entry.capability].status, entry.id).not.toBe('available');
		}
	});

	it('gives the range across the models a visitor can pick', () => {
		expect(actionCreditsRange(action('build'), [16, 136, 445])).toEqual({ min: action('build').steps! * 16, max: action('build').steps! * 445 });
		expect(actionCreditsRange(action('assistant'), [16, 136, 445])).toEqual({ min: action('assistant').credits!, max: action('assistant').credits! });
	});

	it('works out each category from its own inputs', () => {
		expect(creditsFor('build', USAGE)).toBe(3 * actionCredits(action('build'), DEFAULT_RATE));
		expect(creditsFor('change', USAGE)).toBe(2 * 40 * actionCredits(action('change'), DEFAULT_RATE));
		expect(creditsFor('assistant', USAGE)).toBe(2 * 100 * action('assistant').credits!);
	});

	it('adds up only the categories that are switched on', () => {
		expect(monthlyCredits(USAGE)).toBe(creditsFor('build', USAGE) + creditsFor('change', USAGE));
		expect(monthlyCredits({ ...USAGE, categories: { build: false, change: false, assistant: false } })).toBe(0);
	});

	it('costs less with a lighter model', () => {
		expect(monthlyCredits({ ...USAGE, creditsPerStep: 16 })).toBeLessThan(monthlyCredits(USAGE));
	});

	it('suggests typical amounts that grow with the number of stores', () => {
		expect(typicalUsage(1, DEFAULT_RATE).stores).toBe(1);
		expect(monthlyCredits(typicalUsage(5, DEFAULT_RATE))).toBeGreaterThan(monthlyCredits(typicalUsage(1, DEFAULT_RATE)));
		expect(typicalUsage(0, DEFAULT_RATE).stores).toBe(1);
	});

	it('recommends the smallest plan whose monthly credits cover the need, then Premium with extra credits, then Enterprise', () => {
		expect(recommendPlan(0)).toEqual({ plan: 'basic' });
		expect(recommendPlan(5_000)).toEqual({ plan: 'basic' });
		expect(recommendPlan(5_001)).toEqual({ plan: 'pro' });
		expect(recommendPlan(20_000)).toEqual({ plan: 'pro' });
		expect(recommendPlan(100_000)).toEqual({ plan: 'premium', extraCredits: 0 });
		// Extra credits come in thousands, at least 5,000.
		expect(recommendPlan(101_200)).toEqual({ plan: 'premium', extraCredits: 5_000 });
		expect(recommendPlan(112_300)).toEqual({ plan: 'premium', extraCredits: 13_000 });
		expect(recommendPlan(500_000)).toEqual({ plan: 'premium', extraCredits: 400_000 });
		expect(recommendPlan(500_001)).toEqual({ plan: 'enterprise' });
		// With billing off, Basic is today's daily allowance over a month.
		expect(recommendPlan(5_500, 6_000)).toEqual({ plan: 'basic' });
		expect(recommendPlan(6_001, 6_000)).toEqual({ plan: 'pro' });
	});

	it("recommends Basic for one typical store at Sonnet while billing is off, as today's allowance is in the older unit", () => {
		const perDay = 200;
		const needed = monthlyCredits(typicalUsage(1, DEFAULT_RATE));
		expect(recommendPlan(needed, perDay * DAYS_PER_MONTH * LEGACY_CREDIT_FACTOR)).toEqual({ plan: 'basic' });
		// Left in the older unit, the same month would not have fit Basic.
		expect(recommendPlan(needed, perDay * DAYS_PER_MONTH)).not.toEqual({ plan: 'basic' });
	});

	it('looks an action up by its category', () => {
		expect(actionById('change')).toBe(CREDIT_ACTIONS.find((action) => action.id === 'change'));
	});
});
