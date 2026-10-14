import type { ReactNode } from 'react';
import { PLATFORM_FEE_LABEL } from '@/api-types';

export interface CardCopy {
	title: string;
	body: string;
}

export interface FaqItem {
	question: string;
	answer: ReactNode;
}

export const AGENTIC_COMMERCE_SUMMARY =
	'Shoppers increasingly ask AI assistants what to buy. Every Estori store will publish its catalog and checkout in the open agentic commerce standards (UCP and ACP), so assistants can find your products, answer questions about them and complete the purchase, with you as the seller.';

export const TODAY_CARDS: readonly CardCopy[] = [
	{ title: 'A complete store from a sentence', body: 'Catalog, product pages, cart, checkout flow and order records, built and deployed from your description.' },
	{ title: 'Edit by chatting', body: 'Ask for changes in plain words and watch the live preview update.' },
	{ title: 'Desktop and phone', body: 'Every store works on both, and you preview it live on each.' },
];

export const OPERATIONS_CARDS: readonly CardCopy[] = [
	{ title: 'Merchandising', body: 'Collections, featured products and prices stay in order as your catalog changes.' },
	{ title: 'Stock alerts', body: 'A warning before a best-seller runs out, with a suggested reorder.' },
	{ title: 'Order follow-ups', body: 'Shipping updates and review requests go out on time.' },
	{ title: 'Customer replies', body: "Questions about orders, sizes and returns get answers from your store's own information." },
	{ title: 'Visibility in AI answers', body: 'Product pages written and structured so AI answers can cite your store.' },
];

export const PERSONALIZATION_CARDS: readonly CardCopy[] = [
	{ title: 'Recommendations', body: 'Each shopper sees products that fit what they browse and buy.' },
	{ title: 'Smart cart', body: 'The cart suggests what goes well with what is already in it.' },
	{ title: 'Bundles', body: 'Products that sell together are offered together.' },
	{ title: 'Post-purchase offers', body: 'A relevant offer right after checkout, while the shopper is still with you.' },
	{ title: 'AI search', body: 'Shoppers describe what they want and find it, even without the exact words.' },
];

export const AGENTIC_BASICS_CARDS: readonly CardCopy[] = [
	{ title: 'Shoppers ask, assistants act', body: 'A shopper describes what they need, and an AI assistant finds products, compares them and can complete the purchase.' },
	{ title: 'Open standards', body: 'The open agentic commerce standards (UCP and ACP) define how stores share their catalog and checkout with assistants.' },
	{ title: 'You stay the seller', body: 'Orders, payments and the customer relationship stay with your store.' },
];

export const AGENT_READY_CARDS: readonly CardCopy[] = [
	{ title: 'A clean product feed', body: 'Prices, stock, shipping and policies kept current for assistants to read.' },
	{ title: 'Checkout assistants can use', body: 'Cart and checkout endpoints described the way the standards expect.' },
	{ title: 'Verified agents', body: 'Requests from shopping agents are verified before they are trusted.' },
	{ title: 'Secure payment tokens', body: 'Assistants pay with tokens, never with raw card numbers.' },
];

export const CATALOG_CARDS: readonly CardCopy[] = [
	{ title: 'Vetted suppliers', body: 'Every supplier is reviewed for product quality and shipping times before joining.' },
	{ title: 'Added in a few clicks', body: 'Pick products and they arrive in your store with photos, descriptions and prices you can adjust.' },
	{ title: 'The supplier ships', body: "Orders go to the supplier, who ships to your customer under your store's name." },
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

const PAYMENTS_ANSWER = 'Not yet. Stores include a catalog, cart, checkout flow and order records, and built-in payments are coming soon.';

export const BRAND_FAQ: readonly FaqItem[] = [
	{ question: 'Do I need to code?', answer: 'No. You describe your store and ask for changes in plain words.' },
	{ question: 'What can I use today?', answer: 'Building, editing and previewing complete stores. Everything marked Coming soon is on the way.' },
	{ question: 'Can my store take payments?', answer: PAYMENTS_ANSWER },
	{ question: 'What does Coming soon mean?', answer: "A capability we're building. It isn't part of Estori until it launches, and its details may change before then." },
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
	{ question: 'Which AI assistants will Estori stores work with?', answer: 'Any assistant that supports the open agentic commerce standards (UCP and ACP).' },
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
