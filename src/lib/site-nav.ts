import type { CapabilityId } from './capabilities';

export interface NavItem {
	to: string;
	label: string;
	description: string;
	/** Shows this capability's status tag next to the item. */
	capability?: CapabilityId;
}

/** The Solutions menu's "Estori for" column. */
export const AUDIENCES: readonly NavItem[] = [
	{ to: '/solutions/brands', label: 'Brands and store owners', description: 'Build your store in minutes, run it with AI help' },
	{ to: '/solutions/resellers', label: 'Dropshippers and resellers', description: 'Curated products, added in a few clicks', capability: 'product-catalog' },
	{ to: '/solutions/digital', label: 'Digital businesses', description: 'Sell e-books, images and videos, and run your community', capability: 'digital-products' },
];

export const CREATORS_CAPTION = 'Take part in Estori without running a store.';

export const CREATOR_ITEMS: readonly NavItem[] = [
	{ to: '/creators/developers', label: 'Developers', description: 'Build stores, sell them as templates in Discover', capability: 'developer-templates' },
	{ to: '/creators/content', label: 'Content creators', description: "Get paid promoting merchants' products with your link or store", capability: 'content-creators' },
];
