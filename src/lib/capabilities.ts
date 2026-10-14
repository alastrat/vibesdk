/** How a capability shows on the public site; changing a status here updates every tag, button and menu. */
export type CapabilityStatus = 'available' | 'coming-soon' | 'early-access';

export type CapabilityId =
	| 'store-builder'
	| 'agentic-commerce'
	| 'operations-agents'
	| 'personalized-shopping'
	| 'product-catalog'
	| 'digital-products'
	| 'developer-templates'
	| 'content-creators';

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
		description: 'A complete store from a sentence, edited by chat',
		status: 'available',
		path: '/',
	},
	'agentic-commerce': {
		id: 'agentic-commerce',
		name: 'Agentic commerce',
		description: 'Sell through AI shopping assistants',
		status: 'coming-soon',
		path: '/agentic-commerce',
	},
	'operations-agents': {
		id: 'operations-agents',
		name: 'Operations agents',
		description: 'Agents for the day-to-day work of your store',
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
		name: 'Product catalog',
		description: 'Vetted suppliers, added in a few clicks',
		status: 'coming-soon',
		path: '/solutions/resellers#catalog',
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
};

/** The Solutions menu's Platform column, in order. */
export const PLATFORM_CAPABILITIES: readonly CapabilityId[] = [
	'store-builder',
	'agentic-commerce',
	'operations-agents',
	'personalized-shopping',
	'product-catalog',
	'digital-products',
];

export function capabilitiesWithStatus(status: CapabilityStatus): Capability[] {
	return Object.values(CAPABILITIES).filter((capability) => capability.status === status);
}
