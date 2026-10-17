import { COMPLETED_ORDER_MIN_AGE_DAYS, DEFAULT_SELLER_LIMITS, PLATFORM_FEE_LABEL } from '@/api-types';
import { stripeFeesText } from '@/components/payments/payout-costs';
import { OWN_PRODUCTS_WEIGHTING } from '@/lib/plans';
import type { CapabilityId } from '@/lib/capabilities';
import { COMING_SOON_ANSWER, PAYMENTS_ANSWER, type CardCopy, type TextFaqItem } from './positioning';

export interface SolutionSection {
	eyebrow: string;
	title: string;
	cards: readonly CardCopy[];
}

/** The copy of a solution or platform page that SolutionCopyPage lays out. */
export interface SolutionCopy {
	/** The capability whose status the page shows; an early-access one also takes requests. */
	capability: CapabilityId;
	eyebrow: string;
	title: string;
	lead: string;
	sections: readonly SolutionSection[];
	steps: readonly string[];
	faq: readonly TextFaqItem[];
	/** A page that goes deeper, linked below the last section. */
	more?: { to: string; label: string };
}

const COMING_SOON_QUESTION: TextFaqItem = { question: 'What does Coming soon mean?', answer: COMING_SOON_ANSWER };

export const CATALOG_FULFILLMENT_COPY: SolutionCopy = {
	capability: 'product-catalog',
	eyebrow: 'Catalog & fulfillment',
	title: 'Products to sell, shipped for you',
	lead: 'Pick products from a curated catalog of vetted suppliers, and Estori adds them to your store. When a customer orders, the supplier ships it.',
	sections: [
		{
			eyebrow: 'Catalog',
			title: 'Choose from vetted suppliers',
			cards: [
				{ title: 'Vetted suppliers', body: 'Every supplier is reviewed for product quality, shipping times and returns before joining.' },
				{ title: 'Costs up front', body: "See each product's cost, shipping time and your margin before you add it." },
				{ title: 'Product pages written for you', body: "Estori turns each supplier's details into a product page in your store's voice." },
			],
		},
		{
			eyebrow: 'Fulfillment',
			title: 'Orders that ship themselves',
			cards: [
				{ title: 'Orders go straight to the supplier', body: 'When a customer buys, the supplier gets the order, with nothing for you to forward.' },
				{ title: 'Tracking for your customers', body: 'Tracking numbers come back to your store, and your customers follow their delivery.' },
				{ title: 'Your own products too', body: 'Sell what you make alongside catalog products, and ship those yourself from your order records.' },
			],
		},
	],
	steps: [
		'Apply to the catalog when it opens.',
		'Add products and set your prices, and Estori writes the product pages.',
		'Customers order, and suppliers ship to them in plain packaging.',
	],
	faq: [
		{ question: 'Is the catalog available now?', answer: "Not yet, it's coming soon. You can build your store now and add products when the catalog opens." },
		{
			question: 'Who ships the orders?',
			answer: 'For catalog products, the supplier ships each order directly to your customer. For products you make, you ship them yourself.',
		},
		{ question: 'Can I set my own prices?', answer: "Yes. You choose your price, and the margin over the supplier's cost is yours." },
		{ question: 'Can my store take payments?', answer: PAYMENTS_ANSWER },
		COMING_SOON_QUESTION,
	],
	more: { to: '/solutions/resellers', label: 'Estori for dropshippers and resellers' },
};

const { daysSinceFirstSale, completedOrders, maxDisputeRatePercent } = DEFAULT_SELLER_LIMITS.graduation;

/** What makes a new seller an established one, as the level check decides it. */
export const LEVEL_UP_RULE = `${daysSinceFirstSale} days since your first sale, ${completedOrders} completed orders, fewer than ${maxDisputeRatePercent}% of orders disputed and no lost disputes in the last 90 days`;

/** What the level check counts as a completed order. */
export const COMPLETED_ORDER_RULE = `A completed order is paid, at least ${COMPLETED_ORDER_MIN_AGE_DAYS} days old, never disputed, and every catalog item in it was delivered.`;

export const PAYMENTS_COPY: SolutionCopy = {
	capability: 'payments',
	eyebrow: 'Payments',
	title: 'Checkout on your store, payouts to your bank',
	lead: "Shoppers pay on a checkout page at your store's own address, in your store's look. You sell to them, and Estori takes the payment for you through Stripe.",
	sections: [
		{
			eyebrow: 'Checkout',
			title: 'A checkout that looks like your store',
			cards: [
				{ title: 'On your own address', body: "Shoppers pay on a checkout page at your store's own address, with your logo, colors and font. They never leave your store." },
				{ title: 'A cart they can change', body: 'The order summary shows the cart, and shoppers change quantities or remove items right there before they pay.' },
				{ title: 'You are the seller', body: 'Your store is the merchant of record. Shoppers buy from you by card, in US dollars, under your store\'s name.' },
			],
		},
		{
			eyebrow: 'Getting paid',
			title: 'What each sale costs, and when you get paid',
			cards: [
				{
					title: 'What Estori keeps',
					body: "From each sale, Estori keeps the card processing cost, plus the catalog price of any catalog products. When a card costs more to process, such as a card from another country, Estori keeps the difference from that sale.",
				},
				{ title: 'Payouts on your schedule', body: `Choose daily, weekly or monthly payouts to your bank. Your account costs ${stripeFeesText(DEFAULT_SELLER_LIMITS.costs)}.` },
				{ title: 'Templates you sell', body: `Selling a store as a template in Discover costs ${PLATFORM_FEE_LABEL} a sale, and you receive the rest through Stripe.` },
			],
		},
	],
	steps: [
		'Set up payments in Estori: accept the selling terms, connect your Stripe account and add your bank.',
		'Shoppers check out on your store, and Estori orders any catalog products from the supplier.',
		"Your sales are paid out to your bank after your level's wait, on the schedule you choose.",
	],
	faq: [
		{ question: 'Can my store take payments today?', answer: 'Not yet. Payments run in test mode on store previews, so you can try a checkout, and live stores open soon.' },
		{
			question: 'Who pays for refunds?',
			answer: "You do. You pay the whole refund, including the catalog price and card processing of what you refund. A refund goes through when your Stripe balance can cover it.",
		},
		{
			question: 'What happens when a shopper disputes a payment?',
			answer: "You pay the disputed amount and the dispute fee Stripe charges. Estori takes the amount back from the sale when the dispute opens, and returns it if the dispute is decided in your favor.",
		},
		{
			question: 'Why does my store have limits?',
			answer: `Every store has a largest order, a weekly sales limit and a wait before payouts, set by its seller level. ${OWN_PRODUCTS_WEIGHTING} A store that reaches a limit stops taking new orders until the limit allows them again.`,
		},
		{
			question: 'How do my limits grow?',
			answer: `New sellers start with lower limits and a longer wait. After ${LEVEL_UP_RULE}, you become an established seller, with higher limits and faster payouts. ${COMPLETED_ORDER_RULE}`,
		},
		{ question: 'Do my limits depend on my plan?', answer: 'No. Your seller level sets them, the same on every plan.' },
		{
			question: 'Why would an order be held?',
			answer: "When Estori's payment checks flag an order as risky, it's held before Estori buys its catalog products. If it can't be cleared within 24 hours, the shopper is refunded for those products.",
		},
		COMING_SOON_QUESTION,
	],
	more: { to: '/pricing#compare-title', label: 'Payments in each plan' },
};

export const SUBSCRIPTIONS_COPY: SolutionCopy = {
	capability: 'subscriptions',
	eyebrow: 'For subscription businesses',
	title: 'Turn one-time buyers into subscribers',
	lead: 'Sell boxes, memberships and refills that renew on their own, and let subscribers manage their plans from your store.',
	sections: [
		{
			eyebrow: 'Subscriptions',
			title: 'Plans that renew on their own',
			cards: [
				{ title: 'Boxes and refills', body: 'Send a box every month, or refills on the schedule each customer picks.' },
				{ title: 'Memberships', body: 'Sell perks, discounts or members-only products for a monthly or yearly fee.' },
				{ title: 'Plans subscribers control', body: 'Subscribers skip, pause, swap or cancel from their account, without emailing you.' },
			],
		},
		{
			eyebrow: 'Ask in plain words',
			title: 'Describe your plans, and Estori builds them',
			cards: [
				{ title: 'Plan pages', body: 'Ask for a page that compares your plans and what each one includes.' },
				{ title: 'Subscriber accounts', body: 'Give subscribers one place to see their next delivery and change their plan.' },
				{ title: 'Gifts and trials', body: 'Offer gift subscriptions and a first box at a lower price.' },
			],
		},
	],
	steps: ['Build your store with Estori today.', 'Describe your plans when subscriptions launch.', 'Subscribers sign up, and their plans renew on their own.'],
	faq: [
		{ question: 'Can I sell subscriptions today?', answer: 'Not yet. Subscriptions are coming soon. You can build your store now and add your plans when they launch.' },
		{ question: 'Can my store take payments?', answer: PAYMENTS_ANSWER },
		{ question: 'Will subscribers manage their own plans?', answer: "Yes. They'll skip, pause, swap or cancel from their account in your store." },
		COMING_SOON_QUESTION,
	],
};

export const COMMUNITIES_COPY: SolutionCopy = {
	capability: 'digital-products',
	eyebrow: 'For communities',
	title: 'A home for your community, inside your store',
	lead: 'Gather your customers and fans in a members-only space, with posts, events and downloads, right where they buy from you.',
	sections: [
		{
			eyebrow: 'Community',
			title: 'A place to gather',
			cards: [
				{ title: 'Members-only posts', body: 'Share updates, lessons and behind-the-scenes posts that only members see.' },
				{ title: 'Events', body: 'Host live sessions and meetups, and keep the recordings for members.' },
				{ title: 'Conversations', body: 'Members ask questions and talk with each other, not only with you.' },
			],
		},
		{
			eyebrow: 'Membership',
			title: 'Your store and your community, together',
			cards: [
				{ title: 'Free and paid spaces', body: 'Open a free space for everyone and a paid one for your closest fans.' },
				{ title: 'Downloads for members', body: 'Give members e-books, templates and videos as part of joining.' },
				{ title: 'One list of customers', body: 'Your store and your community share one list, so you know who buys and who joins.' },
			],
		},
	],
	steps: ['Request early access.', 'Build your store with Estori.', 'Open your community when it launches, and invite your customers.'],
	faq: [
		{ question: 'Can I start a community today?', answer: "Not yet. It's in early access: request it and we'll email you when you can start." },
		{
			question: 'Is this the same early access as digital products?',
			answer: 'Yes. Communities and digital products launch together, so one request covers both.',
		},
		{ question: 'Can members pay to join?', answer: 'Paid spaces need built-in payments, which are coming soon.' },
		{ question: 'Can I build my store now?', answer: 'Yes. Store building works today, and your store will be ready for your community when it launches.' },
	],
};

export const EMAIL_MARKETING_COPY: SolutionCopy = {
	capability: 'email-marketing',
	eyebrow: 'Email marketing',
	title: 'Email your customers without another tool',
	lead: 'Grow a list from your store, write newsletters just by asking, and set up emails that send themselves when customers act.',
	sections: [
		{
			eyebrow: 'Your list',
			title: 'Grow it from your store',
			cards: [
				{ title: 'Sign-up forms', body: "Add sign-up forms and pop-ups to any page, in your store's style." },
				{ title: 'One customer list', body: 'Subscribers and customers live in one list, so you know who bought what.' },
				{ title: 'Consent built in', body: 'Everyone on your list chose to join, and can leave in one click.' },
			],
		},
		{
			eyebrow: 'Campaigns',
			title: 'Emails you write by asking',
			cards: [
				{ title: 'Newsletters', body: 'Describe the email you want, and Estori drafts it with your products and your brand.' },
				{ title: 'Automatic emails', body: 'Welcome new subscribers, remind shoppers about their carts and thank buyers, on their own.' },
				{ title: 'Results', body: 'See who opens, who clicks and the sales each email brings in.' },
			],
		},
	],
	steps: ['Build your store with Estori.', 'Turn on email when it launches, and add sign-up forms by asking.', 'Write campaigns in plain words, and let the automatic emails run.'],
	faq: [
		{ question: 'Is email marketing available now?', answer: "Not yet, it's coming soon. Build your store today and turn email on when it launches." },
		{ question: 'Will I need another email tool?', answer: 'No. Sign-up forms, campaigns and automatic emails will be part of your Estori store.' },
		{ question: 'Who can I email?', answer: 'People who joined your list. Every email carries a one-click way to leave it.' },
		COMING_SOON_QUESTION,
	],
};

export const WEB_ANALYTICS_COPY: SolutionCopy = {
	capability: 'web-analytics',
	eyebrow: 'Web analytics',
	title: "See what's working in your store",
	lead: 'See how many people visit, where they come from and which pages turn visitors into buyers, built into every store.',
	sections: [
		{
			eyebrow: 'Traffic',
			title: 'Where your visitors come from',
			cards: [
				{ title: 'Visitors and pages', body: 'See daily visitors, the pages they view and how long they stay.' },
				{ title: 'Sources', body: 'Know which links, searches and campaigns bring people to your store.' },
				{ title: 'Devices and countries', body: 'See the phones, computers and countries your visitors use.' },
			],
		},
		{
			eyebrow: 'Sales',
			title: 'What turns visits into orders',
			cards: [
				{ title: 'From visit to checkout', body: 'Follow shoppers from their first page to checkout, and see where they leave.' },
				{ title: 'Top products', body: 'See which products get the most views, carts and orders.' },
				{ title: 'Answers in plain words', body: 'Ask Estori which page to improve first, and get an answer from your numbers.' },
			],
		},
	],
	steps: ['Build your store with Estori.', 'Analytics turn on for every store when they launch, with no code to add.', 'Check your dashboard, or ask Estori what to improve.'],
	faq: [
		{ question: 'Is web analytics available now?', answer: "Not yet, it's coming soon. Your store will have it built in when it launches." },
		{ question: 'Will I need to add tracking code?', answer: 'No. Analytics will be part of every Estori store, with nothing to install.' },
		{ question: 'Can I see which products sell best?', answer: 'Yes. You will see views, carts and orders for every product.' },
		COMING_SOON_QUESTION,
	],
};

export const SEARCH_OPTIMIZATION_COPY: SolutionCopy = {
	capability: 'search-optimization',
	eyebrow: 'SEO, GEO & AEO',
	title: 'Get found in search results and in AI answers',
	lead: 'Shoppers find products by searching, and more and more by asking AI assistants. Estori will tune every store for both.',
	sections: [
		{
			eyebrow: 'SEO',
			title: 'Rank in search results',
			cards: [
				{ title: 'Titles and descriptions', body: 'Every page gets a search title and description written for what you sell.' },
				{ title: 'Product details search engines read', body: 'Products carry structured data, so results can show prices and availability.' },
				{ title: 'A sitemap that stays current', body: 'Search engines learn about every new product and page as you add it.' },
			],
		},
		{
			eyebrow: 'GEO and AEO',
			title: 'Be the answer AI assistants give',
			cards: [
				{
					title: 'GEO',
					body: 'Generative engine optimization helps your store appear in the answers AI assistants write, with clear facts they can quote.',
				},
				{
					title: 'AEO',
					body: "Answer engine optimization makes your pages the direct answer to a shopper's question, with FAQs and guides in plain words.",
				},
				{ title: 'Suggestions as you build', body: 'Estori points out pages that need clearer answers, and improves them when you ask.' },
			],
		},
	],
	steps: ['Build your store with Estori.', 'Optimization turns on for every store when it launches.', 'Ask Estori to improve any page for search results or AI answers.'],
	faq: [
		{ question: 'Is this available now?', answer: "Not yet, it's coming soon. Stores you build today will be ready for it when it launches." },
		{
			question: 'What are GEO and AEO?',
			answer:
				"GEO, generative engine optimization, helps your store appear in answers that AI assistants write. AEO, answer engine optimization, helps it become the direct answer to a shopper's question.",
		},
		{
			question: 'How is this different from getting recommended by AI assistants?',
			answer: 'Getting recommended is about assistants reading your products and suggesting them. SEO, GEO and AEO cover your whole store: its pages, its answers and how it shows up in search.',
		},
		COMING_SOON_QUESTION,
	],
	more: { to: '/agentic-commerce', label: 'How AI recommendations work' },
};
