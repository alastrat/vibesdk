import { PLATFORM_FEE_LABEL } from '@/api-types';

export type BlogCategoryId = 'news' | 'creators';

/** The blog's category links, in order. */
export const BLOG_CATEGORIES: readonly { id: BlogCategoryId; label: string }[] = [
	{ id: 'news', label: 'News' },
	{ id: 'creators', label: 'Creators' },
];

/** The drawing at the top of a post and on its card. */
export type BlogArtId = 'discover';

export type BlogBlock =
	| { type: 'paragraph'; text: string }
	| { type: 'heading'; text: string }
	| { type: 'list'; ordered: boolean; items: readonly string[] };

export interface BlogPost {
	slug: string;
	title: string;
	summary: string;
	/** YYYY-MM-DD. */
	publishedAt: string;
	author: string;
	readMinutes: number;
	categories: readonly BlogCategoryId[];
	art: BlogArtId;
	body: readonly BlogBlock[];
}

/** Newest first. */
export const BLOG_POSTS: readonly BlogPost[] = [
	{
		slug: 'estori-discover-is-open',
		title: 'Estori Discover is open',
		summary: "Sell the stores you design as templates, and start your own store from someone else's.",
		publishedAt: '2026-10-13',
		author: 'The Estori team',
		readMinutes: 2,
		categories: ['news', 'creators'],
		art: 'discover',
		body: [
			{
				type: 'paragraph',
				text: 'Discover is where stores built with Estori are shared. Starting today, the stores you design can be listed there, and anyone can start their own store from one of them.',
			},
			{ type: 'heading', text: 'Sell the stores you design' },
			{ type: 'paragraph', text: 'If you build stores, each one can now earn more than once. Here is how it works:' },
			{
				type: 'list',
				ordered: true,
				items: [
					'Build a store with Estori.',
					'Publish it to Discover and set a price. An Estori admin reviews it before it is listed.',
					`When someone starts from it, they pay through Stripe, and you receive the price minus ${PLATFORM_FEE_LABEL}.`,
				],
			},
			{ type: 'paragraph', text: 'To sell, you need a Stripe account to receive your payouts, and you must be 18 or older.' },
			{ type: 'heading', text: 'Start from a store that already works' },
			{
				type: 'paragraph',
				text: 'If you are opening a store, you no longer have to start from a blank page. Browse Discover, pick a store close to what you have in mind, and get your own copy to adapt for your business by asking for changes in plain words.',
			},
			{
				type: 'paragraph',
				text: "A store you buy is yours to use for your own business; it can't be republished or resold. If it can't be used, email us within 14 days and we'll fix it or refund you.",
			},
			{ type: 'heading', text: "What's next" },
			{
				type: 'paragraph',
				text: "Discover is the first part of Estori that lets creators earn from what they build. We'll share more here as new capabilities launch.",
			},
		],
	},
];

/** The post the announcement bar links to. */
export const ANNOUNCEMENT_POST = 'estori-discover-is-open';

export function blogPostPath(slug: string): string {
	return `/blog/${slug}`;
}

export function findBlogPost(slug: string): BlogPost | undefined {
	return BLOG_POSTS.find((post) => post.slug === slug);
}

/** Every post, or those in one category. */
export function postsInCategory(category: BlogCategoryId | null): readonly BlogPost[] {
	return category ? BLOG_POSTS.filter((post) => post.categories.includes(category)) : BLOG_POSTS;
}

/** "October 13, 2026", read as a calendar date so no time zone moves it. */
export function formatBlogDate(date: string): string {
	return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
