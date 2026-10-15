import { CAPABILITIES, type CapabilityId } from './capabilities';

export type PlanId = 'free' | 'starter' | 'growth' | 'scale';

export interface Plan {
	id: PlanId;
	name: string;
	status: 'available' | 'coming-soon';
	priceCents: number;
	/** Monthly AI credits for building sites and agents' work; null for Free, whose daily allowance is read live. */
	monthlyCredits: number | null;
	/** Live stores included; null for Free, which builds and previews only. */
	liveStores: number | null;
	summary: string;
}

export const PLANS: readonly Plan[] = [
	{ id: 'free', name: 'Free', status: 'available', priceCents: 0, monthlyCredits: null, liveStores: null, summary: 'Build and preview stores with AI.' },
	{ id: 'starter', name: 'Starter', status: 'coming-soon', priceCents: 2_900, monthlyCredits: 10_000, liveStores: 1, summary: 'One live store, ready to be recommended by AI assistants.' },
	{ id: 'growth', name: 'Growth', status: 'coming-soon', priceCents: 7_900, monthlyCredits: 30_000, liveStores: 3, summary: 'Store assistants that handle the daily work, and the product catalog.' },
	{ id: 'scale', name: 'Scale', status: 'coming-soon', priceCents: 24_900, monthlyCredits: 100_000, liveStores: 10, summary: 'More stores, more AI credits and priority support.' },
];

export function formatPlanPrice(plan: Plan): string {
	return `$${plan.priceCents / 100}`;
}

export function formatCredits(credits: number): string {
	return credits.toLocaleString('en-US');
}

export function liveStoresLabel(count: number | null): string {
	if (count === null) return 'Build and preview';
	return count === 1 ? '1 live store' : `${count} live stores`;
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

const ALL: Record<PlanId, PlanCell> = { free: true, starter: true, growth: true, scale: true };
const PAID: Record<PlanId, PlanCell> = { free: false, starter: true, growth: true, scale: true };
const GROWTH_AND_UP: Record<PlanId, PlanCell> = { free: false, starter: false, growth: true, scale: true };

/** A section titled with the capability's registry name, so renaming a capability reaches pricing. */
function capabilitySection(capability: CapabilityId, rows: readonly ComparisonRow[]): ComparisonSection {
	return { title: CAPABILITIES[capability].name, capability, rows };
}

/** What each plan includes, by capability. The pricing page adds the live stores and AI credits rows from PLANS. */
export const PLAN_COMPARISON: readonly ComparisonSection[] = [
	capabilitySection('store-builder', [
		{ label: 'Build and change stores just by asking', cells: ALL },
		{ label: 'Start from templates in Discover', cells: ALL },
	]),
	capabilitySection('agentic-commerce', [{ label: 'Get recommended by AI assistants', cells: PAID }]),
	capabilitySection('operations-agents', [
		{ label: 'Inventory and marketing assistants', cells: GROWTH_AND_UP },
		{ label: 'Customer service assistant', cells: GROWTH_AND_UP },
	]),
	capabilitySection('personalized-shopping', [
		{ label: 'Product suggestions and a smart cart', cells: PAID },
		{ label: 'Bundles, after-purchase offers and smart search', cells: GROWTH_AND_UP },
	]),
	capabilitySection('product-catalog', [{ label: 'Curated supplier catalog', cells: GROWTH_AND_UP }]),
	capabilitySection('digital-products', [{ label: 'Sell digital products and run a community', cells: GROWTH_AND_UP }]),
	{ title: 'Support', capability: null, rows: [{ label: 'Support', cells: { free: 'Email', starter: 'Email', growth: 'Email', scale: 'Priority' } }] },
];
