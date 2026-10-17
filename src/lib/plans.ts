import { DEFAULT_SELLER_LIMITS, PLATFORM_FEE_LABEL } from '@/api-types';
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

export function planById(id: PlanId): Plan {
	const plan = PLANS.find((entry) => entry.id === id);
	if (!plan) throw new Error(`Unknown plan: ${id}`);
	return plan;
}

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
	/** Comes to every plan, Basic included, when it launches; until then its status tag says it isn't here yet. */
	everyPlan?: boolean;
}

const ALL: Record<PlanId, PlanCell> = { basic: true, premium: true, enterprise: true };
const PAID: Record<PlanId, PlanCell> = { basic: false, premium: true, enterprise: true };
const ENTERPRISE: Record<PlanId, PlanCell> = { basic: false, premium: false, enterprise: true };
/** The plans with the supplier catalog; its fee row follows them. */
const CATALOG_PLANS: Record<PlanId, PlanCell> = PAID;

/** A seller level's limits as the public site states them, from the settings checkout enforces. */
export interface SellerLevelLimitsCopy {
	level: string;
	largestOrder: string;
	weeklySales: string;
	payoutWait: string;
}

const { new: NEW_SELLER, established: ESTABLISHED_SELLER } = DEFAULT_SELLER_LIMITS.levels;

export const SELLER_LEVEL_LIMITS: readonly SellerLevelLimitsCopy[] = [
	{ level: 'New sellers', largestOrder: formatUsd(NEW_SELLER.largestOrderCents), weeklySales: formatUsd(NEW_SELLER.weeklySalesCents), payoutWait: `${NEW_SELLER.payoutDelayDays} business days` },
	{
		level: 'Established sellers',
		largestOrder: formatUsd(ESTABLISHED_SELLER.largestOrderCents),
		weeklySales: formatUsd(ESTABLISHED_SELLER.weeklySalesCents),
		payoutWait: `${ESTABLISHED_SELLER.payoutDelayDays} business days`,
	},
];

/** How checkout weighs a cart toward the weekly limit: Estori can't prove the delivery of the seller's own products. */
export const OWN_PRODUCTS_WEIGHTING = 'Your own products count twice toward the weekly limit; catalog products and shipping count once.';

/** The same value on every plan: seller levels set the payment limits, not plans. */
function onEveryPlan(value: PlanCell): Record<PlanId, PlanCell> {
	return { basic: value, premium: value, enterprise: value };
}

/** A value on the plans that have the catalog, and a dash on the others. */
function onCatalogPlans(value: PlanCell): Record<PlanId, PlanCell> {
	return { basic: CATALOG_PLANS.basic && value, premium: CATALOG_PLANS.premium && value, enterprise: CATALOG_PLANS.enterprise && value };
}

/** A section titled with the capability's registry name, so renaming a capability reaches pricing. */
function capabilitySection(capability: CapabilityId, rows: readonly ComparisonRow[], options: { everyPlan?: boolean } = {}): ComparisonSection {
	return { title: CAPABILITIES[capability].name, capability, rows, ...options };
}

/** What each plan includes, by capability. The pricing page adds the credits row from the live allowance and PREMIUM_TIERS. */
export const PLAN_COMPARISON: readonly ComparisonSection[] = [
	capabilitySection('store-builder', [
		{ label: 'Build and change stores just by asking', cells: ALL },
		{ label: 'Live preview on desktop and phone', cells: ALL },
		{ label: 'Start from templates in Discover', cells: ALL },
		{ label: 'Sell your stores as templates', cells: ALL },
		{ label: 'Fee on template sales', cells: { basic: PLATFORM_FEE_LABEL, premium: PLATFORM_FEE_LABEL, enterprise: PLATFORM_FEE_LABEL } },
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
	capabilitySection('product-catalog', [{ label: 'Curated supplier catalog', cells: CATALOG_PLANS }]),
	capabilitySection('payments', [
		{ label: "Checkout on your store's own address", cells: ALL },
		{ label: "Estori's fee on your own products", cells: onEveryPlan('Card processing') },
		{ label: "Estori's fee on catalog products", cells: onCatalogPlans('Card processing and the catalog price') },
		{ label: 'Payouts', cells: onEveryPlan('Daily, weekly or monthly') },
		{ label: 'Largest order, by seller level', cells: onEveryPlan(`${formatUsd(NEW_SELLER.largestOrderCents)} new, ${formatUsd(ESTABLISHED_SELLER.largestOrderCents)} established`) },
		{ label: 'Weekly sales, by seller level', cells: onEveryPlan(`${formatUsd(NEW_SELLER.weeklySalesCents)} new, ${formatUsd(ESTABLISHED_SELLER.weeklySalesCents)} established`) },
		{ label: 'Own products in weekly sales', cells: onEveryPlan('Count twice') },
		{ label: 'Payout wait, by seller level', cells: onEveryPlan(`${NEW_SELLER.payoutDelayDays} business days new, ${ESTABLISHED_SELLER.payoutDelayDays} established`) },
		{ label: 'Refunds and disputes', cells: onEveryPlan('Paid by the seller') },
		// Checking the delivery of orders sellers ship themselves is a Premium feature.
		{ label: 'Delivery checks on orders you ship', cells: PAID },
	], { everyPlan: true }),
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
