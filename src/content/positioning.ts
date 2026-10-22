import { marketingCopy, formatMarketingCopy } from '@/content/marketing-copy';
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
	marketingCopy.home.recommendations.description;

export const TODAY_CARDS: readonly CardCopy[] = [
	{ title: 'A complete store from a sentence', body: 'Catalog, product pages, cart, checkout flow and order records, built and deployed from your description.' },
	{ title: 'Edit by chatting', body: 'Ask for changes in plain words and watch the live preview update.' },
	{ title: 'Desktop and phone', body: 'Every store works on both, and you preview it live on each.' },
];

export const ASSISTANTS_HEADING = marketingCopy.home.assistants.title;

export const ASSISTANTS_LEAD =
	marketingCopy.home.assistants.description;

export type AssistantId = 'inventory' | 'support' | 'marketing';

export interface StoreAssistant {
	id: AssistantId;
	name: string;
	title: string;
	body: string;
}

export const STORE_ASSISTANTS: readonly StoreAssistant[] = [
	{ id: 'inventory', name: marketingCopy.home.assistants.cards.inventory.name, title: marketingCopy.home.assistants.cards.inventory.title, body: marketingCopy.home.assistants.cards.inventory.body },
	{
		id: 'support',
		name: marketingCopy.home.assistants.cards.support.name,
		title: marketingCopy.home.assistants.cards.support.title,
		body: marketingCopy.home.assistants.cards.support.body,
	},
	{ id: 'marketing', name: marketingCopy.home.assistants.cards.marketing.name, title: marketingCopy.home.assistants.cards.marketing.title, body: marketingCopy.home.assistants.cards.marketing.body },
];

export type ShopperCardId = 'picks' | 'cart' | 'offer' | 'search';

export interface ShopperCard extends CardCopy {
	id: ShopperCardId;
}

export const PERSONALIZATION_CARDS: readonly ShopperCard[] = [
	{
		id: 'picks',
		title: marketingCopy.home.personalization.cards.picks.title,
		body: marketingCopy.home.personalization.cards.picks.body,
	},
	{ id: 'cart', title: marketingCopy.home.personalization.cards.cart.title, body: marketingCopy.home.personalization.cards.cart.body },
	{ id: 'offer', title: marketingCopy.home.personalization.cards.offer.title, body: marketingCopy.home.personalization.cards.offer.body },
	{ id: 'search', title: marketingCopy.home.personalization.cards.search.title, body: marketingCopy.home.personalization.cards.search.body },
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

export const RESELLER_STEPS = [marketingCopy.platform.catalog.pickProducts, 'Choose products and set your prices.', 'Sell, and the supplier ships each order.'] as const;

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

export const PAYMENTS_ANSWER = marketingCopy.platform.payments.availabilityAnswer;

export const BRAND_FAQ: readonly FaqItem[] = [
	{ question: 'Do I need to code?', answer: 'No. You describe your store and ask for changes in plain words.' },
	{ question: 'What can I use today?', answer: 'Building, editing and previewing complete stores. Everything marked Coming soon is on the way.' },
	{ question: 'Can my store take payments?', answer: PAYMENTS_ANSWER },
	{ question: 'What does Coming soon mean?', answer: COMING_SOON_ANSWER },
];

export const RESELLER_FAQ: readonly FaqItem[] = [
	{ question: 'When does the catalog open?', answer: "Every plan can browse and add products from the current catalog." },
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
		story: marketingCopy.home.sellers.cards.resellers.story,
	},
	{
		id: 'digital',
		to: '/solutions/digital',
		story: marketingCopy.home.sellers.cards.digital.story,
	},
	{
		id: 'developers',
		to: '/creators/developers',
		story: formatMarketingCopy(marketingCopy.home.sellers.cards.developers.story, { platformFee: PLATFORM_FEE_LABEL }),
	},
	{
		id: 'creators',
		to: '/creators/content',
		story: marketingCopy.home.sellers.cards.creators.story,
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
		tag: marketingCopy.home.features.cards.catalog.tag,
		title: marketingCopy.home.features.cards.catalog.title,
		body: marketingCopy.home.features.cards.catalog.body,
		link: { to: '/discover', label: marketingCopy.home.features.cards.catalog.link.label },
	},
	{
		id: 'checkout',
		tag: marketingCopy.home.features.cards.checkout.tag,
		title: marketingCopy.home.features.cards.checkout.title,
		body: marketingCopy.home.features.cards.checkout.body,
		link: { to: '/#build', label: marketingCopy.home.features.cards.checkout.link.label },
	},
	{
		id: 'orders',
		tag: marketingCopy.home.features.cards.orders.tag,
		title: marketingCopy.home.features.cards.orders.title,
		body: marketingCopy.home.features.cards.orders.body,
		link: { to: '/#build', label: marketingCopy.home.features.cards.orders.link.label },
	},
	{
		id: 'chat',
		tag: marketingCopy.home.features.cards.chat.tag,
		title: marketingCopy.home.features.cards.chat.title,
		body: marketingCopy.home.features.cards.chat.body,
		link: { to: '/#build', label: marketingCopy.home.features.cards.chat.link.label },
	},
	{
		id: 'preview',
		tag: marketingCopy.home.features.cards.preview.tag,
		title: marketingCopy.home.features.cards.preview.title,
		body: marketingCopy.home.features.cards.preview.body,
	},
	{
		id: 'discover',
		tag: marketingCopy.home.features.cards.discover.tag,
		title: marketingCopy.home.features.cards.discover.title,
		body: marketingCopy.home.features.cards.discover.body,
		link: { to: '/discover', label: marketingCopy.home.features.cards.discover.link.label },
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
 * monthly plan allowances and contact-based activation when online checkout is unavailable. `rates` are the models' typical credits per step.
 */
export function pricingFaq(billing: boolean, rates: readonly number[]): readonly FaqItem[] {
	return [
		{
			question: 'What are AI credits?',
			answer: `Credits pay for the AI's work. Each step is charged from the work it really does, at the price of the model you pick, so lighter models go further.${typicalStep(rates)}`,
		},
		{
			question: 'What happens when I run out of credits?',
			answer: 'Building and chatting pause when your credits run out, and your stores keep working. Buy more credits on any plan to keep creating, or wait for your monthly credits to renew.',
		},
		{
			question: 'Can I buy more credits?',
			answer: `Yes, on every plan at the same price: ${EXTRA_CREDITS_PRICE}, from ${formatCredits(EXTRA_CREDITS.minCredits)} at a time. They're used after your monthly credits and last ${EXTRA_CREDITS.monthsValid} months.`,
		},
		{
			question: 'Can I change or cancel my plan?',
			answer: 'Any time, from your billing page. Upgrading to Premium at the same billing frequency happens at once. Downgrading, changing billing frequency or cancelling takes effect at the end of your paid period.',
		},
		{ question: 'Do unused credits roll over?', answer: `Monthly credits don't; extra credits you buy do, for ${EXTRA_CREDITS.monthsValid} months.` },
		...(!billing ? [{ question: 'How do I activate a paid plan?', answer: marketingCopy.pricing.paidActivationAnswer }] : []),
	];
}
