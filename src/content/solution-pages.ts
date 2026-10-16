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
