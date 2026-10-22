import { marketingCopy } from '@/content/marketing-copy';
/** How a capability shows on the public site; changing a status here updates every tag, button and menu. */
export type CapabilityStatus = 'available' | 'coming-soon' | 'early-access';

/** What the badge says for each status that isn't available yet. */
export const STATUS_LABELS: Readonly<Record<Exclude<CapabilityStatus, 'available'>, string>> = {
	'coming-soon': marketingCopy.common.status.comingSoon,
	'early-access': marketingCopy.common.status.earlyAccess,
};

export type CapabilityId =
	| 'store-builder'
	| 'order-management'
	| 'store-translations'
	| 'agentic-commerce'
	| 'operations-agents'
	| 'personalized-shopping'
	| 'product-catalog'
	| 'payments'
	| 'digital-products'
	| 'developer-templates'
	| 'content-creators'
	| 'subscriptions'
	| 'email-marketing'
	| 'web-analytics'
	| 'search-optimization';

export interface Capability {
	id: CapabilityId;
	name: string;
	description: string;
	status: CapabilityStatus;
	/** The page, or page section, that explains it. */
	path: string;
}

export const CAPABILITIES: Readonly<Record<CapabilityId, Capability>> = {
	'store-builder': {
		id: 'store-builder',
		name: marketingCopy.navigation.capabilities['store-builder'].name,
		description: marketingCopy.navigation.capabilities['store-builder'].description,
		status: 'available',
		path: '/',
	},
	'order-management': {
		id: 'order-management',
		name: marketingCopy.navigation.capabilities['order-management'].name,
		description: marketingCopy.navigation.capabilities['order-management'].description,
		status: 'available',
		path: '/platform/payments#orders',
	},
	'store-translations': {
		id: 'store-translations',
		name: marketingCopy.navigation.capabilities['store-translations'].name,
		description: marketingCopy.navigation.capabilities['store-translations'].description,
		status: 'available',
		path: '/platform/store-translations',
	},
	'agentic-commerce': {
		id: 'agentic-commerce',
		name: marketingCopy.navigation.capabilities['agentic-commerce'].name,
		description: marketingCopy.navigation.capabilities['agentic-commerce'].description,
		status: 'coming-soon',
		path: '/agentic-commerce',
	},
	'operations-agents': {
		id: 'operations-agents',
		name: marketingCopy.navigation.capabilities['operations-agents'].name,
		description: marketingCopy.navigation.capabilities['operations-agents'].description,
		status: 'coming-soon',
		path: '/solutions/brands#operations',
	},
	'personalized-shopping': {
		id: 'personalized-shopping',
		name: marketingCopy.navigation.capabilities['personalized-shopping'].name,
		description: marketingCopy.navigation.capabilities['personalized-shopping'].description,
		status: 'coming-soon',
		path: '/solutions/brands#personalization',
	},
	'product-catalog': {
		id: 'product-catalog',
		name: marketingCopy.navigation.capabilities['product-catalog'].name,
		description: marketingCopy.navigation.capabilities['product-catalog'].description,
		status: 'available',
		path: '/platform/catalog-fulfillment',
	},
	payments: {
		id: 'payments',
		name: marketingCopy.navigation.capabilities.payments.name,
		description: marketingCopy.navigation.capabilities.payments.description,
		status: 'available',
		path: '/platform/payments',
	},
	'digital-products': {
		id: 'digital-products',
		name: marketingCopy.navigation.capabilities['digital-products'].name,
		description: marketingCopy.navigation.capabilities['digital-products'].description,
		status: 'early-access',
		path: '/solutions/digital',
	},
	'developer-templates': {
		id: 'developer-templates',
		name: marketingCopy.navigation.capabilities['developer-templates'].name,
		description: marketingCopy.navigation.capabilities['developer-templates'].description,
		status: 'available',
		path: '/creators/developers',
	},
	'content-creators': {
		id: 'content-creators',
		name: marketingCopy.navigation.capabilities['content-creators'].name,
		description: marketingCopy.navigation.capabilities['content-creators'].description,
		status: 'early-access',
		path: '/creators/content',
	},
	subscriptions: {
		id: 'subscriptions',
		name: marketingCopy.navigation.capabilities.subscriptions.name,
		description: marketingCopy.navigation.capabilities.subscriptions.description,
		status: 'coming-soon',
		path: '/solutions/subscriptions',
	},
	'email-marketing': {
		id: 'email-marketing',
		name: marketingCopy.navigation.capabilities['email-marketing'].name,
		description: marketingCopy.navigation.capabilities['email-marketing'].description,
		status: 'coming-soon',
		path: '/platform/email-marketing',
	},
	'web-analytics': {
		id: 'web-analytics',
		name: marketingCopy.navigation.capabilities['web-analytics'].name,
		description: marketingCopy.navigation.capabilities['web-analytics'].description,
		status: 'coming-soon',
		path: '/platform/web-analytics',
	},
	'search-optimization': {
		id: 'search-optimization',
		name: marketingCopy.navigation.capabilities['search-optimization'].name,
		description: marketingCopy.navigation.capabilities['search-optimization'].description,
		status: 'coming-soon',
		path: '/platform/seo',
	},
};

/** The Solutions menu's Platform column, in order. */
export const PLATFORM_CAPABILITIES: readonly CapabilityId[] = [
	'store-builder',
	'product-catalog',
	'order-management',
	'store-translations',
	'payments',
	'operations-agents',
	'personalized-shopping',
	'email-marketing',
	'web-analytics',
	'search-optimization',
];

export function capabilitiesWithStatus(status: CapabilityStatus): Capability[] {
	return Object.values(CAPABILITIES).filter((capability) => capability.status === status);
}
