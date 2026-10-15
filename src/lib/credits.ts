import type { CapabilityId } from './capabilities';
import { premiumTierFor, type PremiumTier } from './plans';

/**
 * Credits pay for the AI's work. The builder charges each AI step at the chosen model's rate (the `creditCost` the
 * platform publishes with its models), so building and changing a store are priced as typical steps times that rate.
 * The coming-soon actions have a fixed estimate. All are estimates: bigger stores and longer requests take more steps.
 */
export type UsageCategory = 'build' | 'change' | 'assistant' | 'personalization';

export interface CreditAction {
	id: UsageCategory;
	name: string;
	description: string;
	unit: string;
	/** Typical AI steps for one unit, charged at the model's rate. */
	steps?: number;
	/** Typical credits for one unit, whatever the model. */
	credits?: number;
	/** Set while the capability behind the action isn't available yet. */
	capability?: CapabilityId;
}

export const CREDIT_ACTIONS: readonly CreditAction[] = [
	{ id: 'build', name: 'Build a store', description: 'The AI plans and writes your pages, catalog, cart and checkout.', unit: 'store', steps: 30 },
	{ id: 'change', name: 'Change by chatting', description: 'Each request to add, restyle or fix something in a store.', unit: 'change', steps: 4 },
	{
		id: 'assistant',
		name: 'Store assistant tasks',
		description: 'A restock suggestion, an answer to a customer or a cart reminder.',
		unit: 'task',
		credits: 3,
		capability: 'operations-agents',
	},
	{
		id: 'personalization',
		name: 'Personalized shopping',
		description: 'Product picks, cart suggestions and smart search for each shopper.',
		unit: '1,000 shopper visits',
		credits: 3,
		capability: 'personalized-shopping',
	},
];

/** The free daily allowance becomes a month of credits with this many days. */
export const DAYS_PER_MONTH = 30;

/** Typical credits for one unit of an action at a model's rate per step. */
export function actionCredits(action: CreditAction, creditsPerStep: number): number {
	return action.steps !== undefined ? action.steps * creditsPerStep : (action.credits ?? 0);
}

/** The lightest and heaviest cost of an action across the models a visitor can pick. */
export function actionCreditsRange(action: CreditAction, rates: readonly number[]): { min: number; max: number } {
	const costs = rates.length > 0 ? rates.map((rate) => actionCredits(action, rate)) : [actionCredits(action, 0)];
	return { min: Math.min(...costs), max: Math.max(...costs) };
}

/** What a visitor tells the calculator about a typical month. */
export interface Usage {
	/** The chosen model's credits per AI step. */
	creditsPerStep: number;
	stores: number;
	categories: Readonly<Record<UsageCategory, boolean>>;
	/** Stores built from scratch this month. */
	newStores: number;
	changesPerStore: number;
	assistantTasksPerStore: number;
	visitsPerStore: number;
}

function actionById(category: UsageCategory): CreditAction {
	const action = CREDIT_ACTIONS.find((entry) => entry.id === category);
	if (!action) throw new Error(`No credit action for ${category}`);
	return action;
}

/** One category's credits for the month, whether or not it's switched on. */
export function creditsFor(category: UsageCategory, usage: Usage): number {
	const each = actionCredits(actionById(category), usage.creditsPerStep);
	switch (category) {
		case 'build':
			return usage.newStores * each;
		case 'change':
			return usage.stores * usage.changesPerStore * each;
		case 'assistant':
			return usage.stores * usage.assistantTasksPerStore * each;
		case 'personalization':
			return Math.round(usage.stores * (usage.visitsPerStore / 1_000) * each);
	}
}

/** The month's credits across the categories that are switched on. */
export function monthlyCredits(usage: Usage): number {
	return CREDIT_ACTIONS.reduce((total, action) => (usage.categories[action.id] ? total + creditsFor(action.id, usage) : total), 0);
}

/** Typical amounts for a number of stores: each built once and changed often, with the coming-soon categories off. */
export function typicalUsage(stores: number, creditsPerStep: number): Usage {
	const count = Math.max(1, Math.round(stores));
	return {
		creditsPerStep,
		stores: count,
		categories: { build: true, change: true, assistant: false, personalization: false },
		newStores: count,
		changesPerStore: 30,
		assistantTasksPerStore: 150,
		visitsPerStore: 5_000,
	};
}

export type Recommendation = { plan: 'basic' } | { plan: 'premium'; tier: PremiumTier } | { plan: 'enterprise' };

/** Basic while its free allowance covers the month, else the smallest Premium pool, else Enterprise. */
export function recommendPlan(credits: number, freeMonthlyCredits: number | null): Recommendation {
	if (freeMonthlyCredits !== null && credits <= freeMonthlyCredits) return { plan: 'basic' };
	const tier = premiumTierFor(credits);
	return tier ? { plan: 'premium', tier } : { plan: 'enterprise' };
}
