import type { ReactNode } from 'react';
import { EXTRA_CREDITS, PLATFORM_FEE_LABEL, formatCredits } from '@/api-types';
import { EXTRA_CREDITS_PRICE } from '@/lib/plans';

export interface CardCopy {
	title: string;
	body: string;
}

export interface FaqItem {
	question: string;
	answer: ReactNode;
}

/** A question with a plain-text answer, so it can go in structured data as well as on the page. */
export interface TextFaqItem extends FaqItem {
	answer: string;
}

export const AGENTIC_COMMERCE_SUMMARY =
	'More and more people ask AI assistants for product recommendations. Your store will share its products in a way those assistants can read, so they can recommend you and send buyers to your store.';

export const TODAY_CARDS: readonly CardCopy[] = [
	{ title: 'A complete store from a sentence', body: 'Catalog, product pages, cart, checkout flow and order records, built and deployed from your description.' },
	{ title: 'Edit by chatting', body: 'Ask for changes in plain words and watch the live preview update.' },
	{ title: 'Desktop and phone', body: 'Every store works on both, and you preview it live on each.' },
];

export const ASSISTANTS_HEADING = 'Hand off the daily work of running your store';

export const ASSISTANTS_LEAD =
	"Estori's assistants keep an eye on your stock, your customers and your sales, and take care of the routine work, following rules you set.";

export type AssistantId = 'inventory' | 'support' | 'marketing';

export interface StoreAssistant {
	id: AssistantId;
	name: string;
	title: string;
	body: string;
}

export const STORE_ASSISTANTS: readonly StoreAssistant[] = [
	{ id: 'inventory', name: 'Inventory assistant', title: 'Never run out of best-sellers', body: 'Warns you before a product sells out and suggests how much to reorder.' },
	{
		id: 'support',
		name: 'Customer service assistant',
		title: 'Questions answered, day and night',
		body: "Replies to questions about orders, sizes and returns using your store's own information.",
	},
	{ id: 'marketing', name: 'Marketing assistant', title: 'Bring shoppers back', body: 'Reminds shoppers who left items in their cart and sends offers to your repeat customers.' },
];

export type ShopperCardId = 'picks' | 'cart' | 'offer' | 'search';

export interface ShopperCard extends CardCopy {
	id: ShopperCardId;
}

export const PERSONALIZATION_CARDS: readonly ShopperCard[] = [
	{
		id: 'picks',
		title: 'Products picked for each shopper',
		body: 'Machine learning scores every product for every shopper, so each one sees their best matches.',
	},
	{ id: 'cart', title: 'A cart that suggests what goes with it', body: "Add-ons and bundles that go with what's already in the cart." },
	{ id: 'offer', title: 'An offer right after checkout', body: 'A relevant offer right after checkout, while the shopper is still with you.' },
	{ id: 'search', title: 'Search that understands shoppers', body: 'Shoppers describe what they want and find it, even without the exact words.' },
];

export const AGENTIC_BASICS_CARDS: readonly CardCopy[] = [
	{ title: 'Shoppers ask, assistants answer', body: 'A shopper describes what they need, and an AI assistant suggests products and can help them buy.' },
	{
		title: 'A shared language for stores',
		body: 'Stores and AI assistants talk through the open agentic commerce standards (UCP and ACP), so any assistant that supports them can read your store.',
	},
	{ title: 'You stay the seller', body: 'Orders, payments and the customer relationship stay with your store.' },
];

export const AGENT_READY_CARDS: readonly CardCopy[] = [
	{ title: 'Up-to-date product details', body: 'Prices, stock, shipping and policies kept current, so assistants recommend what you can actually sell.' },
	{ title: 'A checkout assistants can use', body: 'Shoppers can finish buying without getting lost between the assistant and your store.' },
	{ title: 'Only trusted assistants', body: 'Requests from AI assistants are checked before your store answers them.' },
	{ title: 'Secure payments', body: 'Assistants pay with secure tokens, never with raw card numbers.' },
];

export const CATALOG_CARDS: readonly CardCopy[] = [
	{ title: 'Vetted suppliers', body: 'Every supplier is reviewed for product quality and shipping times before joining.' },
	{ title: 'Added in a few clicks', body: 'Pick products and they arrive in your store with photos, descriptions and prices you can adjust.' },
	{ title: 'The supplier ships', body: 'Orders go to the supplier, who ships to your customer in plain packaging, with no supplier branding.' },
	{ title: 'You keep the margin', body: "You set your price, and the difference over the supplier's cost is yours." },
];

export const DIGITAL_PRODUCT_CARDS: readonly CardCopy[] = [
	{ title: 'E-books and guides', body: 'Sell what you know as downloads your customers get right after paying.' },
	{ title: 'Images and design assets', body: 'Photos, illustrations and templates, delivered as files.' },
	{ title: 'Videos and courses', body: 'Lessons and video content, organized for your customers.' },
];

export const COMMUNITY_CARDS: readonly CardCopy[] = [
	{ title: 'A members-only space', body: 'A place for your customers to talk with you and each other.' },
	{ title: 'Updates and drops', body: 'Announce new products and content to the people who care most.' },
	{ title: 'Your customers, in one place', body: 'Your store and your community share one list of customers.' },
];

export const CONTENT_CREATOR_CARDS: readonly CardCopy[] = [
	{ title: 'Your own link', body: 'Share a personal link in your videos, posts and newsletters.' },
	{ title: 'Or your own store', body: 'Gather the products you recommend in a store built with Estori.' },
	{ title: 'A commission per sale', body: 'Each merchant sets the commission for their products.' },
	{ title: 'Clear reporting', body: 'Clicks, sales and earnings in one place.' },
];

export const BRAND_STEPS = [
	'Describe your brand and what you sell.',
	'Watch Estori build the store, then refine it by chat.',
	'Preview it on desktop and phone, and share it when it is ready.',
] as const;

export const RESELLER_STEPS = ['Apply to the catalog.', 'Choose products and set your prices.', 'Sell, and the supplier ships each order.'] as const;

export const DIGITAL_STEPS = [
	'Request early access.',
	'Build your store with Estori.',
	'Add your digital products and open your community when it launches.',
] as const;

export const DEVELOPER_STEPS = [
	'Build a store with Estori.',
	'Publish it to Discover and set a price. An Estori admin reviews it.',
	'Earn when someone starts from it: buyers pay through Stripe and you receive the rest.',
] as const;

export const CONTENT_STEPS = ['Request early access.', 'Choose merchants and products to promote.', 'Share your link or store, and earn per sale.'] as const;

export const COMING_SOON_ANSWER = "A capability we're building. It isn't part of Estori until it launches, and its details may change before then.";

/** Plan-neutral: true whether paid plans are on sale or not. */
export const FREE_PLAN_ANSWER = 'Building and editing stores is free on Basic, within its limits. See the pricing page for what each plan includes.';

export const PAYMENTS_ANSWER = 'Not yet. Stores include a catalog, cart, checkout flow and order records, and built-in payments are coming soon.';

export const BRAND_FAQ: readonly FaqItem[] = [
	{ question: 'Do I need to code?', answer: 'No. You describe your store and ask for changes in plain words.' },
	{ question: 'What can I use today?', answer: 'Building, editing and previewing complete stores. Everything marked Coming soon is on the way.' },
	{ question: 'Can my store take payments?', answer: PAYMENTS_ANSWER },
	{ question: 'What does Coming soon mean?', answer: COMING_SOON_ANSWER },
];

export const RESELLER_FAQ: readonly FaqItem[] = [
	{ question: 'When does the catalog open?', answer: "It's coming soon. You can build your store now and add products when it opens." },
	{ question: 'Who handles shipping?', answer: 'The supplier ships each order directly to your customer.' },
	{ question: 'Can I set my own prices?', answer: 'Yes. You choose your price, and the margin over the supplier is yours.' },
	{ question: 'Can my store take payments?', answer: PAYMENTS_ANSWER },
];

export const DIGITAL_FAQ: readonly FaqItem[] = [
	{ question: 'Is this available yet?', answer: "Not yet. It's in early access: request it and we'll email you when you can start." },
	{ question: 'Why do I need an account to request it?', answer: 'Your request is saved to your Estori account, so we know where to reach you when it opens.' },
	{ question: 'Can I build my store now?', answer: 'Yes. Store building works today, and your store will be ready for digital products when they launch.' },
];

export const AGENTIC_FAQ: readonly FaqItem[] = [
	{
		question: 'Which AI assistants will Estori stores work with?',
		answer: 'Any assistant that supports the open agentic commerce standards (UCP and ACP), the shared rules for how assistants read stores.',
	},
	{ question: 'Do I need to set anything up?', answer: 'No. When it launches, it comes with every Estori store.' },
	{ question: 'Is it available yet?', answer: "Not yet. It's coming soon to every Estori store." },
];

export const DEVELOPER_FAQ: readonly FaqItem[] = [
	{ question: 'What does Estori charge?', answer: `${PLATFORM_FEE_LABEL} per sale. You receive the rest through Stripe.` },
	{ question: 'What do I need to sell?', answer: 'A Stripe account, and you must be 18 or older.' },
	{ question: 'Can buyers resell my store?', answer: "No. A buyer gets their own copy for their own business, and it can't be republished or resold." },
];

export const CONTENT_FAQ: readonly FaqItem[] = [
	{ question: 'Do I need to run a store?', answer: 'No. You can promote merchants with your own link. A store of your own is optional.' },
	{ question: 'How much can I earn?', answer: "Each merchant sets its commission. Estori's share is announced when the program launches." },
	{ question: 'Is it available yet?', answer: "Not yet. It's in early access: request it and we'll email you when it opens." },
];

export type SellerId = 'resellers' | 'digital' | 'developers' | 'creators';

/** The landing page's sellers after brands: each story beside its card, keyed to its page in the menus. */
export interface SellerStory {
	id: SellerId;
	to: string;
	story: string;
}

export const SELLER_STORIES: readonly SellerStory[] = [
	{
		id: 'resellers',
		to: '/solutions/resellers',
		story: 'Skip the supplier hunt. The catalog will list vetted products with clear costs and shipping times. Add what fits in a few clicks, and Estori writes the product pages.',
	},
	{
		id: 'digital',
		to: '/solutions/digital',
		story: 'Sell e-books, images and videos with instant delivery, and keep your buyers close in a community that lives inside your store.',
	},
	{
		id: 'developers',
		to: '/creators/developers',
		story: `Build a store once and sell it as a template in Discover. Every buyer gets their own copy to make theirs, and you keep the price minus ${PLATFORM_FEE_LABEL}.`,
	},
	{
		id: 'creators',
		to: '/creators/content',
		story: 'Share products you love with your own link or store, and get paid for every sale you bring to a merchant.',
	},
];

export type StoreFeatureId = 'catalog' | 'checkout' | 'orders' | 'chat' | 'preview' | 'discover';

/** What every store has today, on the landing page's cards; `tag` labels the tab a card raises on hover. */
export interface StoreFeature extends CardCopy {
	id: StoreFeatureId;
	tag: string;
	/** Where the card leads; the preview card has none, its device switch takes the link's place. */
	link?: { to: string; label: string };
}

export const STORE_FEATURES: readonly StoreFeature[] = [
	{
		id: 'catalog',
		tag: 'Catalog',
		title: 'Catalog and product pages',
		body: 'Products, variants, filters and detailed product pages, generated from your description.',
		link: { to: '/discover', label: 'See stores in Discover' },
	},
	{
		id: 'checkout',
		tag: 'Checkout',
		title: 'Cart and checkout flow',
		body: 'A cart, a checkout form and order confirmations your customers already know how to use.',
		link: { to: '/#build', label: 'Start building' },
	},
	{
		id: 'orders',
		tag: 'Orders',
		title: 'Order records',
		body: 'Your store keeps its orders in its own database, ready for you to review.',
		link: { to: '/#build', label: 'Start building' },
	},
	{
		id: 'chat',
		tag: 'AI editing',
		title: 'Edit by chatting',
		body: 'Ask for a new section, a different style or more products, and the AI updates the live store.',
		link: { to: '/#build', label: 'Try it' },
	},
	{
		id: 'preview',
		tag: 'Live preview',
		title: 'Desktop and phone preview',
		body: 'Every store works on both, and you watch every change live on each before you share it.',
	},
	{
		id: 'discover',
		tag: 'Templates',
		title: 'Start with a Template',
		body: 'Pick a store someone built, get your own copy and make it yours by chatting.',
		link: { to: '/discover', label: 'Browse Discover' },
	},
];

/** "A typical step takes about 16 to 445 credits.", from the models' typical credits per step; empty until they're known. */
function typicalStep(rates: readonly number[]): string {
	if (rates.length === 0) return '';
	const low = Math.min(...rates);
	const high = Math.max(...rates);
	return ` A typical step takes about ${low === high ? formatCredits(low) : `${formatCredits(low)} to ${formatCredits(high)}`} credits.`;
}

/**
 * The pricing page's questions, shown before the launch questions: the plans and extra credits once billing is on, and
 * today's free allowance with Pro and Premium coming soon until then. `rates` are the models' typical credits per step.
 */
export function pricingFaq(billing: boolean, rates: readonly number[]): readonly FaqItem[] {
	if (!billing) {
		return [
			{
				question: 'What are AI credits?',
				answer: "Credits pay for the AI's work. Each step it takes while building or changing your store uses credits at the rate of the model you pick, so lighter models go further.",
			},
			{
				question: 'What happens when I run out of credits?',
				answer: 'On Basic, building and chatting pause until your allowance refills at midnight UTC. Your stores and their previews keep working.',
			},
			{
				question: 'Are Pro and Premium available now?',
				answer: "Not yet, they're coming soon. Tell us what you need and we'll set you up as they open.",
			},
			{ question: 'Do unused credits roll over?', answer: "No. Basic's allowance refills every day." },
		];
	}
	return [
		{
			question: 'What are AI credits?',
			answer: `Credits pay for the AI's work. Each step is charged from the work it really does, at the price of the model you pick, so lighter models go further.${typicalStep(rates)}`,
		},
		{
			question: 'What happens when I run out of credits?',
			answer: 'Building and chatting pause until your credits renew, and your stores keep working. On Premium you can buy extra credits at once.',
		},
		{
			question: 'Can I buy more credits?',
			answer: `On Premium, yes: ${EXTRA_CREDITS_PRICE}, from ${formatCredits(EXTRA_CREDITS.minCredits)} at a time. They're used after your monthly credits and last ${EXTRA_CREDITS.monthsValid} months.`,
		},
		{
			question: 'Can I change or cancel my plan?',
			answer: 'Any time, from your billing page. Moving to Premium happens at once; moving to Pro or cancelling happens at the end of the month you paid for.',
		},
		{ question: 'Do unused credits roll over?', answer: `Monthly credits don't; extra credits you buy do, for ${EXTRA_CREDITS.monthsValid} months.` },
	];
}
