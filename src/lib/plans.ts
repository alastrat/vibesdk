import { DEFAULT_SELLER_LIMITS, EXTRA_CREDITS, PLAN_LIMITS, PLATFORM_FEE_LABEL, formatCredits, formatUsd, type PaidPlanId, type PlanId } from '@/api-types';
import { CAPABILITIES, type CapabilityId } from './capabilities';

export { formatCredits, formatUsd };
export type { PlanId };

export interface Plan {
	id: PlanId;
	name: string;
	tagline: string;
}

export const PLANS: readonly Plan[] = [
	{ id: 'basic', name: 'Basic', tagline: 'Build and preview your stores with AI, free.' },
	{ id: 'pro', name: 'Pro', tagline: 'More credits and live stores for sellers growing a few stores.' },
	{ id: 'premium', name: 'Premium', tagline: 'A monthly pool of credits for brands building and running their stores.' },
	{ id: 'enterprise', name: 'Enterprise', tagline: 'Custom credits, terms and support for larger teams.' },
];

export function planById(id: PlanId): Plan {
	const plan = PLANS.find((entry) => entry.id === id);
	if (!plan) throw new Error(`Unknown plan: ${id}`);
	return plan;
}

/** "$1.50 per 1,000", the price of extra credits. */
export const EXTRA_CREDITS_PRICE = `${formatUsd(EXTRA_CREDITS.unitPriceCents)} per ${formatCredits(EXTRA_CREDITS.creditsPerUnit)}`;

/** "Up to 3 live stores, 10 new stores a day", from a paid plan's limits. */
export function storeAllowance(plan: PaidPlanId): string {
	const { liveStores, newStoresPerDay } = PLAN_LIMITS[plan];
	const parts: string[] = [];
	if (liveStores !== null) parts.push(`Up to ${liveStores} live stores`);
	if (newStoresPerDay !== null) parts.push(`${newStoresPerDay} new stores a day`);
	return parts.join(', ');
}

/** A paid plan's limits as short feature lines; with `over`, only the lines that plan doesn't already have. */
export function limitFeatures(plan: PaidPlanId, over?: PaidPlanId): string[] {
	const limits = PLAN_LIMITS[plan];
	const lines = [storeAllowance(plan)];
	if (limits.ownDomainsPerLiveStore > 0) lines.push('Your own domain on each live store');
	if (limits.supplierCatalog) lines.push('The supplier catalog');
	if (limits.extraCredits) lines.push('Buy extra credits any time');
	if (over === undefined) return lines;
	const already = limitFeatures(over);
	return lines.filter((line) => !already.includes(line));
}

/** A check (true), a dash (false) or a short text. */
export type PlanCell = boolean | string;

export interface ComparisonRow {
	label: string;
	cells: Readonly<Record<PlanId, PlanCell>>;
	/** A row about the limits billing introduces; the table leaves it out while billing is off. */
	billingOnly?: boolean;
}

export interface ComparisonSection {
	title: string;
	/** The capability whose status tag the section shows; null for plain sections. */
	capability: CapabilityId | null;
	rows: readonly ComparisonRow[];
	/** Comes to every plan, Basic included, when it launches; until then its status tag says it isn't here yet. */
	everyPlan?: boolean;
}

const ALL: Record<PlanId, PlanCell> = { basic: true, pro: true, premium: true, enterprise: true };
const PAID: Record<PlanId, PlanCell> = { basic: false, pro: true, premium: true, enterprise: true };
const ENTERPRISE: Record<PlanId, PlanCell> = { basic: false, pro: false, premium: false, enterprise: true };
/** The plans with the supplier catalog, from the shared limits; its fee row follows them. */
const CATALOG_PLANS: Record<PlanId, PlanCell> = {
	basic: PLAN_LIMITS.basic.supplierCatalog,
	pro: PLAN_LIMITS.pro.supplierCatalog,
	premium: PLAN_LIMITS.premium.supplierCatalog,
	enterprise: PLAN_LIMITS.enterprise.supplierCatalog,
};

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
	return { basic: value, pro: value, premium: value, enterprise: value };
}

/** A value on the plans that have the catalog, and a dash on the others. */
function onCatalogPlans(value: PlanCell): Record<PlanId, PlanCell> {
	return {
		basic: CATALOG_PLANS.basic && value,
		pro: CATALOG_PLANS.pro && value,
		premium: CATALOG_PLANS.premium && value,
		enterprise: CATALOG_PLANS.enterprise && value,
	};
}

/** A section titled with the capability's registry name, so renaming a capability reaches pricing. */
function capabilitySection(capability: CapabilityId, rows: readonly ComparisonRow[], options: { everyPlan?: boolean } = {}): ComparisonSection {
	return { title: CAPABILITIES[capability].name, capability, rows, ...options };
}

/** What each plan includes, by capability. The pricing page adds the credits row from the live allowance and PLAN_LIMITS. */
export const PLAN_COMPARISON: readonly ComparisonSection[] = [
	capabilitySection('store-builder', [
		{ label: 'Build and change stores just by asking', cells: ALL },
		{ label: 'Live preview on desktop and phone', cells: ALL },
		{
			label: 'Stores',
			cells: {
				basic: `${PLAN_LIMITS.basic.storesLifetime}`,
				pro: `${PLAN_LIMITS.pro.newStoresPerDay} new a day`,
				premium: `${PLAN_LIMITS.premium.newStoresPerDay} new a day`,
				enterprise: 'Custom',
			},
			billingOnly: true,
		},
		{
			label: 'Live stores at once',
			cells: {
				basic: String(PLAN_LIMITS.basic.liveStores),
				pro: String(PLAN_LIMITS.pro.liveStores),
				premium: String(PLAN_LIMITS.premium.liveStores),
				enterprise: 'Custom',
			},
			billingOnly: true,
		},
		{ label: 'Your own domain', cells: { basic: false, pro: 'One per live store', premium: 'One per live store', enterprise: 'One per live store' }, billingOnly: true },
		{ label: 'Extra AI credits', cells: { basic: false, pro: false, premium: EXTRA_CREDITS_PRICE, enterprise: true }, billingOnly: true },
		{ label: 'Start from templates in Discover', cells: ALL },
		{ label: 'Sell your stores as templates', cells: ALL },
		{ label: 'Fee on template sales', cells: onEveryPlan(PLATFORM_FEE_LABEL) },
		{ label: 'Email receipts for your template buyers', cells: ALL },
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
		// The emails Estori sends with each store order, the same on every plan.
		{ label: 'An email to you for every new order', cells: ALL },
		{ label: 'Order emails to your shoppers', cells: onEveryPlan('Confirmation, shipped and refund') },
		{ label: 'Edit each shopper email, or turn it off', cells: ALL },
		{ label: "Shopper emails from your store's own address", cells: ALL },
		// Checking the delivery of orders sellers ship themselves is a Premium feature.
		{ label: 'Delivery checks on orders you ship', cells: PAID },
	], { everyPlan: true }),
	capabilitySection('digital-products', [{ label: 'Sell digital products and run a community', cells: PAID }]),
	{
		title: 'Support and billing',
		capability: null,
		rows: [
			{ label: 'Support', cells: { basic: 'Email', pro: 'Email', premium: 'Priority email', enterprise: 'A named contact' } },
			{ label: 'Custom credit volume', cells: ENTERPRISE },
			{ label: 'Invoiced billing', cells: ENTERPRISE },
		],
	},
];

const PLANS_WITHOUT_BILLING = PLANS.filter((plan) => plan.id !== 'pro');
const COMPARISON_WITHOUT_BILLING: readonly ComparisonSection[] = PLAN_COMPARISON.map((section) => ({
	...section,
	rows: section.rows.filter((row) => !row.billingOnly),
}));

/** The columns and sections the comparison shows. With billing off it is today's table: no Pro column and none of the limit rows. */
export function comparisonFor(billing: boolean): { plans: readonly Plan[]; sections: readonly ComparisonSection[] } {
	return billing ? { plans: PLANS, sections: PLAN_COMPARISON } : { plans: PLANS_WITHOUT_BILLING, sections: COMPARISON_WITHOUT_BILLING };
}
