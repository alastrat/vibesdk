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

/** Where a purchase was paid. `test` records a purchase without charging. */
export const TEMPLATE_PAYMENT_PROVIDERS = ['test'] as const;
export type TemplatePaymentProvider = (typeof TEMPLATE_PAYMENT_PROVIDERS)[number];

/** Discover's pricing filter. */
export const DISCOVER_PRICING_FILTERS = ['all', 'free', 'paid'] as const;
export type DiscoverPricing = (typeof DISCOVER_PRICING_FILTERS)[number];

export function formatTemplatePrice(priceCents: number): string {
	if (priceCents <= 0) return 'Free';
	const dollars = priceCents / 100;
	return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
