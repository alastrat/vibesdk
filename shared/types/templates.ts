/** Template catalog values shared by the database schema, the worker and the UI. */

export const TEMPLATE_CATEGORIES = [
	'store',
	'landing',
	'portfolio',
	'restaurant',
	'saas',
	'services',
	'other',
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
	store: 'Store',
	landing: 'Landing page',
	portfolio: 'Portfolio',
	restaurant: 'Restaurant',
	saas: 'SaaS',
	services: 'Services',
	other: 'Other',
};

export const TEMPLATE_VERSION_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn', 'superseded'] as const;
export type TemplateVersionStatus = (typeof TEMPLATE_VERSION_STATUSES)[number];

export const TEMPLATE_LISTING_STATUSES = ['listed', 'unlisted'] as const;
export type TemplateListingStatus = (typeof TEMPLATE_LISTING_STATUSES)[number];

export const USER_ROLES = ['user', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export type TemplateShotKind = 'desktop' | 'mobile';

/** Prices a creator can choose, in US cents. 0 means free. */
export const TEMPLATE_PRICE_OPTIONS_CENTS = [0, 900, 1900, 2900, 4900] as const;

/** Where a purchase was paid. 'test' purchases predate Stripe and charged nothing. */
export const TEMPLATE_PAYMENT_PROVIDERS = ['test', 'stripe'] as const;
export type TemplatePaymentProvider = (typeof TEMPLATE_PAYMENT_PROVIDERS)[number];

/** Discover's pricing filter. */
export const DISCOVER_PRICING_FILTERS = ['all', 'free', 'paid'] as const;
export type DiscoverPricing = (typeof DISCOVER_PRICING_FILTERS)[number];

export function formatTemplatePrice(priceCents: number): string {
	if (priceCents <= 0) return 'Free';
	const dollars = priceCents / 100;
	return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/** Estori's share of every sale: a percent of the price plus a fixed amount that covers Stripe's card fee. */
export const PLATFORM_FEE_PERCENT = 7;
export const PLATFORM_FEE_FIXED_CENTS = 60;

/** The fee as sellers see it: "7% + $0.60". */
export const PLATFORM_FEE_LABEL = `${PLATFORM_FEE_PERCENT}% + $${(PLATFORM_FEE_FIXED_CENTS / 100).toFixed(2)}`;

/** Estori's fee on a sale, rounded to the nearest cent; a free site has none. */
export function platformFeeCents(priceCents: number): number {
	if (priceCents <= 0) return 0;
	return Math.round((priceCents * PLATFORM_FEE_PERCENT) / 100) + PLATFORM_FEE_FIXED_CENTS;
}
