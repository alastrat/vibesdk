import { marketingCopy } from '@/content/marketing-copy';
import type { CapabilityId } from './capabilities';

/** The menu icon for an item, by name; the menu maps each to its drawing. */
export type NavIcon = 'storefront' | 'package' | 'download' | 'repeat' | 'users' | 'code' | 'megaphone';

export interface NavItem {
	to: string;
	label: string;
	description: string;
	icon: NavIcon;
	/** Shows this capability's status tag next to the item. */
	capability?: CapabilityId;
}

/** The Solutions menu's "Estori for" column. */
export const AUDIENCES: readonly NavItem[] = [
	{ to: '/solutions/brands', label: marketingCopy.navigation.audiences.brands.label, description: marketingCopy.navigation.audiences.brands.description, icon: 'storefront' },
	{ to: '/solutions/resellers', label: marketingCopy.navigation.audiences.resellers.label, description: marketingCopy.navigation.audiences.resellers.description, icon: 'package', capability: 'product-catalog' },
	{ to: '/solutions/digital', label: marketingCopy.navigation.audiences.digital.label, description: marketingCopy.navigation.audiences.digital.description, icon: 'download', capability: 'digital-products' },
	{ to: '/solutions/subscriptions', label: marketingCopy.navigation.audiences.subscriptions.label, description: marketingCopy.navigation.audiences.subscriptions.description, icon: 'repeat', capability: 'subscriptions' },
	{ to: '/solutions/communities', label: marketingCopy.navigation.audiences.communities.label, description: marketingCopy.navigation.audiences.communities.description, icon: 'users', capability: 'digital-products' },
];

export const CREATORS_CAPTION = marketingCopy.navigation.creatorsCaption;

export const CREATOR_ITEMS: readonly NavItem[] = [
	{ to: '/creators/developers', label: marketingCopy.navigation.creators.developers.label, description: marketingCopy.navigation.creators.developers.description, icon: 'code', capability: 'developer-templates' },
	{ to: '/creators/content', label: marketingCopy.navigation.creators.content.label, description: marketingCopy.navigation.creators.content.description, icon: 'megaphone', capability: 'content-creators' },
];
