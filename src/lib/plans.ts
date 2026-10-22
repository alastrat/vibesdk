import { marketingCopy } from '@/content/marketing-copy';
import { msg } from '../../shared/i18n/translate';
import { DEFAULT_SELLER_LIMITS, PLAN_LIMITS, extraCreditsPriceLabel, formatCredits, formatUsd, limitFeatures, storeAllowance, type PlanId } from '@/api-types';
import { CAPABILITIES, type CapabilityId } from './capabilities';

export { extraCreditsPriceLabel, formatCredits, formatUsd, limitFeatures, storeAllowance };
export type { PlanId };

export interface Plan {
	id: PlanId;
	name: string;
	tagline: string;
}

export const PLANS: readonly Plan[] = [
	{ id: 'basic', name: 'Basic', tagline: marketingCopy.pricing.plans.basic.description },
	{ id: 'pro', name: 'Pro', tagline: marketingCopy.pricing.plans.pro.description },
	{ id: 'premium', name: 'Premium', tagline: marketingCopy.pricing.plans.premium.description },
	{ id: 'enterprise', name: 'Enterprise', tagline: 'Custom credits, terms and support for larger teams.' },
];

export function planById(id: PlanId): Plan {
	const plan = PLANS.find((entry) => entry.id === id);
	if (!plan) throw new Error(`Unknown plan: ${id}`);
	return plan;
}

/** "$1.50 per 1,000", the price of extra credits, in English for the public pages; the app words it with `extraCreditsPriceLabel`. */
export const EXTRA_CREDITS_PRICE = extraCreditsPriceLabel();

/** A check (true), a dash (false) or a short text. */
export type PlanCell = boolean | string;

export interface ComparisonRow {
	id: string;
	label: string;
	description: string;
	cells: Readonly<Record<PlanId, PlanCell>>;
}

export interface ComparisonSection {
	title: string;
	/** The capability whose status tag the section shows; null for plain sections. */
	capability: CapabilityId | null;
	rows: readonly ComparisonRow[];
	/** Comes to every plan, Basic included, when it launches; until then its status tag says it isn't here yet. */
	everyPlan?: boolean;
	details?: { label: string; href: string };
}

const ALL: Record<PlanId, PlanCell> = { basic: true, pro: true, premium: true, enterprise: true };
const PAID: Record<PlanId, PlanCell> = { basic: false, pro: true, premium: true, enterprise: true };
/** Commerce controls use the same entitlements as the API. */
const SHOPPER_EMAIL_PLANS = Object.fromEntries(Object.entries(PLAN_LIMITS).map(([plan, limits]) => [plan, limits.shopperEmails])) as Record<PlanId, PlanCell>;
const CUSTOM_EMAIL_PLANS = Object.fromEntries(Object.entries(PLAN_LIMITS).map(([plan, limits]) => [plan, limits.customShopperEmails])) as Record<PlanId, PlanCell>;
const TRACKING_PLANS = Object.fromEntries(Object.entries(PLAN_LIMITS).map(([plan, limits]) => [plan, limits.shipmentTracking])) as Record<PlanId, PlanCell>;
const REFUND_PLANS = Object.fromEntries(Object.entries(PLAN_LIMITS).map(([plan, limits]) => [plan, limits.orderRefunds])) as Record<PlanId, PlanCell>;
const FLEXIBLE_PAYOUT_PLANS = Object.fromEntries(Object.entries(PLAN_LIMITS).map(([plan, limits]) => [plan, limits.flexiblePayouts])) as Record<PlanId, PlanCell>;
/** Catalog access and automatic fulfillment share the account catalog permission. */
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
export const OWN_PRODUCTS_WEIGHTING = msg('Your own products count twice toward the weekly limit; catalog products and shipping count once.');

/** A section titled with the capability's registry name, so renaming a capability reaches pricing. */
function capabilitySection(capability: CapabilityId, rows: readonly ComparisonRow[], options: { everyPlan?: boolean; details?: ComparisonSection['details'] } = {}): ComparisonSection {
	return { title: CAPABILITIES[capability].name, capability, rows, ...options };
}

/** Stable keys keep the English labels editable without changing plan eligibility. */
function feature(id: keyof typeof marketingCopy.pricing.comparison.features, cells: Readonly<Record<PlanId, PlanCell>>): ComparisonRow {
	const copy = marketingCopy.pricing.comparison.features[id];
	return {
		id,
		...copy,
		cells,
	};
}

/** Plan benefits and allowances, with prices and limits sourced from the product rules. */
export const PLAN_COMPARISON: readonly ComparisonSection[] = [
	capabilitySection('store-builder', [
		feature('stores', {
			basic: String(PLAN_LIMITS.basic.storesLifetime),
			pro: String(PLAN_LIMITS.pro.storesLifetime),
			premium: String(PLAN_LIMITS.premium.storesLifetime),
			enterprise: 'Custom',
		}),
		feature('aiCredits', {
			basic: `${formatCredits(PLAN_LIMITS.basic.aiCredits)}/mo`,
			pro: `${formatCredits(PLAN_LIMITS.pro.aiCredits)}/mo`,
			premium: `${formatCredits(PLAN_LIMITS.premium.aiCredits)}/mo`,
			enterprise: 'Custom',
		}),
		feature('build', ALL),
		feature('preview', ALL),
		feature('publish', ALL),
		feature('appLanguages', ALL),

		feature('templates', ALL),
		feature('sellTemplates', ALL),
		feature('receipts', ALL),
		feature('domain', { basic: PLAN_LIMITS.basic.ownDomainsPerLiveStore > 0, pro: PLAN_LIMITS.pro.ownDomainsPerLiveStore > 0, premium: PLAN_LIMITS.premium.ownDomainsPerLiveStore > 0, enterprise: PLAN_LIMITS.enterprise.ownDomainsPerLiveStore > 0 }),
	]),
	capabilitySection('product-catalog', [feature('ownProducts', ALL), feature('catalog', CATALOG_PLANS), feature('fulfillment', CATALOG_PLANS)]),
	capabilitySection('order-management', [
		feature('orders', ALL),
		feature('orderStatus', ALL),
		feature('tracking', TRACKING_PLANS),
		feature('refunds', REFUND_PLANS),
	]),
	{
		title: marketingCopy.pricing.comparison.emailNotifications,
		capability: null,
		rows: [
			feature('sellerEmails', ALL),
			feature('shopperEmails', SHOPPER_EMAIL_PLANS),
			feature('brandedEmails', SHOPPER_EMAIL_PLANS),
			feature('previewEmails', SHOPPER_EMAIL_PLANS),
			feature('editEmails', CUSTOM_EMAIL_PLANS),
			feature('replyToEmails', CUSTOM_EMAIL_PLANS),
		],
	},
	capabilitySection('store-translations', [
		feature('aiTranslation', PAID),
		feature('editTranslations', PAID),
		feature('publishTranslations', PAID),
		feature('languageSwitcher', PAID),
		feature('translationControl', PAID),
	]),
	capabilitySection('payments', [
		feature('checkout', ALL),
		feature('bankPayouts', ALL),
		feature('payouts', FLEXIBLE_PAYOUT_PLANS),
	], { everyPlan: true, details: { label: marketingCopy.pricing.comparison.paymentDetails, href: '/platform/payments#limits' } }),
	capabilitySection('digital-products', [feature('digital', PAID)]),
	capabilitySection('agentic-commerce', [feature('aiDiscovery', PAID)]),
	capabilitySection('operations-agents', [feature('operations', PAID), feature('customerService', PAID)]),
	capabilitySection('personalized-shopping', [feature('personalization', PAID), feature('bundles', PAID)]),
	{
		title: 'Support',
		capability: null,
		rows: [
			feature('support', ALL),
			feature('prioritySupport', PAID),
			feature('accountManager', { basic: false, pro: false, premium: true, enterprise: true }),
		],
	},
];

/** The public comparison always covers the three self-service plans. Checkout availability only changes the action buttons. */
export function comparisonFor(): { plans: readonly Plan[]; sections: readonly ComparisonSection[] } {
	return { plans: PLANS.filter((plan) => plan.id !== 'enterprise'), sections: PLAN_COMPARISON };
}
