import { marketingCopy } from './marketing-copy';
import type { FaqItem } from './positioning';
import { BRANDS_PAGE, COMMUNITIES_PAGE, DIGITAL_PAGE, RESELLERS_PAGE, SUBSCRIPTIONS_PAGE } from './public-pages';
import type { IndustrySlug } from './industries';
import type { CapabilityId } from '@/lib/capabilities';
import type { PageHead } from '@/lib/page-head';

export type SolutionId = keyof typeof marketingCopy.solutions;
export type SolutionVisualId = 'store' | 'editor' | 'catalog' | 'orders' | 'translation' | 'downloads' | 'community' | 'subscription';
export interface SolutionImage {
	src: string;
	alt: string;
	width: number;
	height: number;
	position?: string;
}
export interface SolutionFeatureArt {
	visual: SolutionVisualId;
	photo?: IndustrySlug;
	image?: SolutionImage;
}
export interface SolutionLandingDefinition {
	head: PageHead;
	copy: typeof marketingCopy.solutions.brands;
	capability?: CapabilityId;
	sectionId?: string;
	more?: { to: string; label: string };
	art: {
		hero: SolutionVisualId;
		features: readonly SolutionFeatureArt[];
		examples: readonly SolutionFeatureArt[];
	};
	faq: readonly FaqItem[];
	future: readonly {
		id: string;
		capability: CapabilityId;
		detailLink?: boolean;
	}[];
}

const COMMUNITY_IMAGES = {
	conversation: {
		src: '/marketing/communities/home-growth-03.avif',
		alt: 'Two podcast hosts sharing a conversation in a recording studio',
		width: 790,
		height: 788,
		position: 'center 60%',
	},
	creator: {
		src: '/marketing/communities/home-creator-types-06.avif',
		alt: 'A creator speaking into a microphone in a blue recording studio',
		width: 1600,
		height: 1263,
		position: 'center 35%',
	},
	host: {
		src: '/marketing/communities/home-creator-types-04.avif',
		alt: 'A smiling host wearing earbuds and recording with a microphone',
		width: 1600,
		height: 1894,
		position: 'center 30%',
	},
} satisfies Record<string, SolutionImage>;

export const SOLUTION_LANDINGS: Record<SolutionId, SolutionLandingDefinition> = {
	brands: {
		head: BRANDS_PAGE,
		copy: marketingCopy.solutions.brands,
		faq: marketingCopy.solutions.brands.faq,
		art: {
			hero: 'store',
			features: [
				{ visual: 'store', photo: 'fashion-apparel' },
				{ visual: 'editor' },
				{ visual: 'orders' },
				{
					visual: 'translation',
					image: {
						src: '/marketing/brands/brand-conversation.webp',
						alt: 'A smiling person discussing ideas beside a laptop with a pen and notebook',
						width: 3200,
						height: 3200,
						position: 'center 35%',
					},
				},
			],
			examples: [
				{ visual: 'store', photo: 'home-living' },
				{ visual: 'store', photo: 'food-beverage' },
				{ visual: 'store', photo: 'sports-outdoors' },
			],
		},
		future: [
			{
				id: 'agentic-commerce',
				capability: 'agentic-commerce',
				detailLink: true,
			},
			{ id: 'operations', capability: 'operations-agents' },
			{ id: 'personalization', capability: 'personalized-shopping' },
		],
	},
	resellers: {
		head: RESELLERS_PAGE,
		copy: marketingCopy.solutions.resellers,
		faq: marketingCopy.solutions.resellers.faq,
		capability: 'product-catalog',
		sectionId: 'catalog',
		more: {
			to: '/platform/catalog-fulfillment',
			label: 'Explore catalog and fulfillment',
		},
		art: {
			hero: 'catalog',
			features: [
				{ visual: 'catalog', photo: 'sports-outdoors' },
				{ visual: 'editor' },
				{ visual: 'orders' },
				{
					visual: 'store',
					image: {
						src: '/marketing/resellers/jo-franco.avif',
						alt: 'A smiling creator holding stacks of notebooks in front of a bookshelf',
						width: 1367,
						height: 1367,
						position: 'center 35%',
					},
				},
			],
			examples: [
				{ visual: 'catalog', photo: 'sports-outdoors' },
				{ visual: 'store', photo: 'home-living' },
				{ visual: 'store', photo: 'food-beverage' },
			],
		},
		future: [],
	},
	digital: {
		head: DIGITAL_PAGE,
		copy: marketingCopy.solutions.digital,
		faq: marketingCopy.solutions.digital.faq,
		capability: 'digital-products',
		art: {
			hero: 'downloads',
			features: [
				{
					visual: 'downloads',
					image: {
						src: '/marketing/digital/creator-at-work.avif',
						alt: 'A creator working on digital designs at a laptop in her studio',
						width: 2240,
						height: 973,
						position: '25% center',
					},
				},
				{ visual: 'downloads' },
				{ visual: 'editor' },
				{
					visual: 'community',
					image: {
						src: '/marketing/digital/01-Prerna-Mayank-Malik.avif',
						alt: 'Two smiling creators sharing a moment together outside a café',
						width: 1600,
						height: 1600,
						position: 'center 30%',
					},
				},
			],
			examples: [
				{ visual: 'downloads', photo: 'home-living' },
				{ visual: 'downloads', photo: 'fashion-apparel' },
				{ visual: 'store', photo: 'jewelry-accessories' },
			],
		},
		future: [],
	},
	subscriptions: {
		head: SUBSCRIPTIONS_PAGE,
		copy: marketingCopy.solutions.subscriptions,
		faq: marketingCopy.solutions.subscriptions.faq,
		capability: 'subscriptions',
		art: {
			hero: 'subscription',
			features: [
				{ visual: 'subscription', photo: 'food-beverage' },
				{ visual: 'subscription' },
				{ visual: 'orders' },
				{ visual: 'store', photo: 'health-wellness' },
			],
			examples: [
				{ visual: 'subscription', photo: 'food-beverage' },
				{ visual: 'store', photo: 'home-living' },
				{ visual: 'community', photo: 'jewelry-accessories' },
			],
		},
		future: [],
	},
	communities: {
		head: COMMUNITIES_PAGE,
		copy: marketingCopy.solutions.communities,
		faq: marketingCopy.solutions.communities.faq,
		capability: 'digital-products',
		art: {
			hero: 'community',
			features: [
				{
					visual: 'community',
					image: COMMUNITY_IMAGES.conversation,
				},
				{ visual: 'downloads' },
				{ visual: 'community' },
				{ visual: 'store', image: COMMUNITY_IMAGES.creator },
			],
			examples: [
				{
					visual: 'community',
					image: COMMUNITY_IMAGES.conversation,
				},
				{ visual: 'downloads', image: COMMUNITY_IMAGES.creator },
				{ visual: 'community', image: COMMUNITY_IMAGES.host },
			],
		},
		future: [],
	},
};
