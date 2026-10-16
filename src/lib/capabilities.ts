/** How a capability shows on the public site; changing a status here updates every tag, button and menu. */
export type CapabilityStatus = 'available' | 'coming-soon' | 'early-access';

/** What the badge says for each status that isn't available yet. */
export const STATUS_LABELS: Readonly<Record<Exclude<CapabilityStatus, 'available'>, string>> = {
	'coming-soon': 'Coming soon',
	'early-access': 'Early access',
};

export type CapabilityId =
	| 'store-builder'
	| 'agentic-commerce'
	| 'operations-agents'
	| 'personalized-shopping'
	| 'product-catalog'
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
		name: 'AI store builder',
		description: 'A complete store from a description, changed just by asking',
		status: 'available',
		path: '/',
	},
	'agentic-commerce': {
		id: 'agentic-commerce',
		name: 'Get found by AI assistants',
		description: 'Be recommended when shoppers ask AI',
		status: 'coming-soon',
		path: '/agentic-commerce',
	},
	'operations-agents': {
		id: 'operations-agents',
		name: 'Store assistants',
		description: 'Help with stock, customers and marketing',
		status: 'coming-soon',
		path: '/solutions/brands#operations',
	},
	'personalized-shopping': {
		id: 'personalized-shopping',
		name: 'Personalized shopping',
		description: 'Recommendations, a smart cart and AI search',
		status: 'coming-soon',
		path: '/solutions/brands#personalization',
	},
	'product-catalog': {
		id: 'product-catalog',
		name: 'Catalog & fulfillment',
		description: "Vetted suppliers' products, shipped for you",
		status: 'coming-soon',
		path: '/platform/catalog-fulfillment',
	},
	'digital-products': {
		id: 'digital-products',
		name: 'Digital products and community',
		description: 'Sell downloads and run your community',
		status: 'early-access',
		path: '/solutions/digital',
	},
	'developer-templates': {
		id: 'developer-templates',
		name: 'Templates in Discover',
		description: 'Build stores and sell them as templates',
		status: 'available',
		path: '/creators/developers',
	},
	'content-creators': {
		id: 'content-creators',
		name: 'Content creator program',
		description: "Get paid promoting merchants' products",
		status: 'early-access',
		path: '/creators/content',
	},
	subscriptions: {
		id: 'subscriptions',
		name: 'Subscriptions',
		description: 'Boxes, memberships and refills that renew on their own',
		status: 'coming-soon',
		path: '/solutions/subscriptions',
	},
	'email-marketing': {
		id: 'email-marketing',
		name: 'Email marketing',
		description: 'Newsletters and automatic emails, written by asking',
		status: 'coming-soon',
		path: '/platform/email-marketing',
	},
	'web-analytics': {
		id: 'web-analytics',
		name: 'Web analytics',
		description: 'Visitors, sources and sales, built into your store',
		status: 'coming-soon',
		path: '/platform/web-analytics',
	},
	'search-optimization': {
		id: 'search-optimization',
		name: 'SEO, GEO & AEO optimization',
		description: 'Show up in search results and in AI answers',
		status: 'coming-soon',
		path: '/platform/seo',
	},
};

/** The Solutions menu's Platform column, in order. */
export const PLATFORM_CAPABILITIES: readonly CapabilityId[] = [
	'store-builder',
	'product-catalog',
	'operations-agents',
	'personalized-shopping',
	'email-marketing',
	'web-analytics',
	'search-optimization',
];

export function capabilitiesWithStatus(status: CapabilityStatus): Capability[] {
	return Object.values(CAPABILITIES).filter((capability) => capability.status === status);
}
