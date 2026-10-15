import { CAPABILITIES, type CapabilityId } from './capabilities';

export type PlanId = 'basic' | 'premium' | 'enterprise';

export interface Plan {
	id: PlanId;
	name: string;
	tagline: string;
}

export const PLANS: readonly Plan[] = [
	{ id: 'basic', name: 'Basic', tagline: 'Build and preview your stores with AI, free.' },
	{ id: 'premium', name: 'Premium', tagline: 'A monthly pool of credits for brands building and running their stores.' },
	{ id: 'enterprise', name: 'Enterprise', tagline: 'Custom credits, terms and support for larger teams.' },
];

/** A Premium credit pool and its monthly price. */
export interface PremiumTier {
	credits: number;
	priceCents: number;
}

/** Premium's monthly credit pools, smallest first; the first sets the advertised price. Bigger pools cost less per credit. */
export const PREMIUM_TIERS: readonly PremiumTier[] = [
	{ credits: 20_000, priceCents: 9_900 },
	{ credits: 50_000, priceCents: 19_900 },
	{ credits: 100_000, priceCents: 34_900 },
	{ credits: 200_000, priceCents: 59_900 },
];

/** The smallest Premium pool that covers `credits` a month, or null when only Enterprise can. */
export function premiumTierFor(credits: number): PremiumTier | null {
	return PREMIUM_TIERS.find((tier) => tier.credits >= credits) ?? null;
}

/** "$99", or "$349.50" when there are cents. */
export function formatUsd(cents: number): string {
	const dollars = cents / 100;
	return `$${Number.isInteger(dollars) ? dollars.toLocaleString('en-US') : dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatCredits(credits: number): string {
	return credits.toLocaleString('en-US');
}

/** A check (true), a dash (false) or a short text. */
export type PlanCell = boolean | string;

export interface ComparisonRow {
	label: string;
	cells: Readonly<Record<PlanId, PlanCell>>;
}

export interface ComparisonSection {
	title: string;
	/** The capability whose status tag the section shows; null for plain sections. */
	capability: CapabilityId | null;
	rows: readonly ComparisonRow[];
}

const ALL: Record<PlanId, PlanCell> = { basic: true, premium: true, enterprise: true };
const PAID: Record<PlanId, PlanCell> = { basic: false, premium: true, enterprise: true };
const ENTERPRISE: Record<PlanId, PlanCell> = { basic: false, premium: false, enterprise: true };

/** A section titled with the capability's registry name, so renaming a capability reaches pricing. */
function capabilitySection(capability: CapabilityId, rows: readonly ComparisonRow[]): ComparisonSection {
	return { title: CAPABILITIES[capability].name, capability, rows };
}

/** What each plan includes, by capability. The pricing page adds the credits row from the live allowance and PREMIUM_TIERS. */
export const PLAN_COMPARISON: readonly ComparisonSection[] = [
	capabilitySection('store-builder', [
		{ label: 'Build and change stores just by asking', cells: ALL },
		{ label: 'Live preview on desktop and phone', cells: ALL },
		{ label: 'Start from templates in Discover', cells: ALL },
		{ label: 'Sell your stores as templates', cells: ALL },
	]),
	capabilitySection('agentic-commerce', [{ label: 'Get recommended by AI assistants', cells: PAID }]),
	capabilitySection('operations-agents', [
		{ label: 'Inventory and marketing assistants', cells: PAID },
		{ label: 'Customer service assistant', cells: PAID },
	]),
	capabilitySection('personalized-shopping', [
		{ label: 'Product picks and a smart cart', cells: PAID },
		{ label: 'Bundles, after-checkout offers and smart search', cells: PAID },
	]),
	capabilitySection('product-catalog', [{ label: 'Curated supplier catalog', cells: PAID }]),
	capabilitySection('digital-products', [{ label: 'Sell digital products and run a community', cells: PAID }]),
	{
		title: 'Support and billing',
		capability: null,
		rows: [
			{ label: 'Support', cells: { basic: 'Email', premium: 'Priority email', enterprise: 'A named contact' } },
			{ label: 'Custom credit volume', cells: ENTERPRISE },
			{ label: 'Invoiced billing', cells: ENTERPRISE },
		],
	},
];
