import { PLATFORM_FEE_LABEL } from '@/api-types';
import type { PageHead } from '@/lib/page-head';
import type { JsonLdNode } from '@/lib/seo';
import { BLOG_POSTS, blogPostPath, type BlogPost } from './blog';
import { INDUSTRIES, INDUSTRIES_PAGE, INDUSTRIES_PATH, industriesStructuredData, industryPath, industryStructuredData, type Industry } from './industries';
import { LEGAL_DOCUMENTS, LEGAL_SLUGS, type LegalSlug } from './legal/legal-documents';

/**
 * A page anyone can visit. The page renders its head from this, and the worker writes the same head into the HTML it
 * serves, for link previews and crawlers that never run the app, and lists the page in the sitemap.
 */
export interface PublicPage extends PageHead {
	path: string;
	/** Schema.org data for the page, with addresses on the origin serving it. */
	structuredData?: (origin: string) => JsonLdNode;
	/** The day the page last changed, as YYYY-MM-DD. */
	lastModified?: string;
}

export const HOME_PAGE: PublicPage = {
	path: '/',
	description:
		'Describe your store and Estori builds it in minutes, with your products, cart and checkout. AI assistants that help you sell and run it are coming soon.',
};

export const BRANDS_PAGE: PublicPage = {
	path: '/solutions/brands',
	title: 'For brands',
	description: "Build your brand's online store in minutes. Getting recommended by AI assistants, store assistants and personalized shopping are coming soon.",
};

export const RESELLERS_PAGE: PublicPage = {
	path: '/solutions/resellers',
	title: 'For dropshippers and resellers',
	description: 'A curated catalog of vetted suppliers is coming soon to Estori. Build the store for it today.',
};

export const DIGITAL_PAGE: PublicPage = {
	path: '/solutions/digital',
	title: 'For digital businesses',
	description: 'Sell e-books, images and videos and run a community from your Estori store. In early access.',
};

export const SUBSCRIPTIONS_PAGE: PublicPage = {
	path: '/solutions/subscriptions',
	title: 'For subscription businesses',
	description: 'Sell boxes, memberships and refills that renew on their own from your Estori store. Subscriptions are coming soon; build your store today.',
};

export const COMMUNITIES_PAGE: PublicPage = {
	path: '/solutions/communities',
	title: 'For communities',
	description: 'Run a members-only community inside your Estori store, with posts, events and downloads. In early access.',
};

export const EMAIL_MARKETING_PAGE: PublicPage = {
	path: '/platform/email-marketing',
	title: 'Email marketing',
	description: 'Grow a list from your Estori store, write newsletters by asking and set up emails that send themselves. Coming soon.',
};

export const WEB_ANALYTICS_PAGE: PublicPage = {
	path: '/platform/web-analytics',
	title: 'Web analytics',
	description: 'See who visits your Estori store, where they come from and which pages turn visitors into buyers, built in. Coming soon.',
};

export const SEARCH_OPTIMIZATION_PAGE: PublicPage = {
	path: '/platform/seo',
	title: 'SEO, GEO & AEO optimization',
	description: 'Help your Estori store show up in search results and in the answers AI assistants give. Coming soon.',
};

export const INDUSTRIES_HUB_PAGE: PublicPage = {
	path: INDUSTRIES_PATH,
	title: INDUSTRIES_PAGE.metaTitle,
	description: INDUSTRIES_PAGE.metaDescription,
	structuredData: industriesStructuredData,
};

export const AGENTIC_COMMERCE_PAGE: PublicPage = {
	path: '/agentic-commerce',
	title: 'Get found by AI assistants',
	description: 'How shoppers find products by asking AI assistants, and how every Estori store will be ready to be recommended.',
};

export const DEVELOPERS_PAGE: PublicPage = {
	path: '/creators/developers',
	title: 'For developers',
	description: 'Build stores with Estori, publish them to Discover as templates, and get paid through Stripe.',
};

export const CONTENT_CREATORS_PAGE: PublicPage = {
	path: '/creators/content',
	title: 'For content creators',
	description: 'Get paid for the products you recommend, with your own link or your own Estori store. In early access.',
};

export const DISCOVER_PAGE: PublicPage = {
	path: '/discover',
	title: 'Discover',
	description: 'Explore sites built by the community, and start your own from any of them',
};

export const PRICING_PAGE: PublicPage = {
	path: '/pricing',
	title: 'Pricing',
	description: `Build with Estori for free on Basic. Premium, with a monthly pool of AI credits, is coming soon, and Enterprise is tailored with our team. Template sellers pay ${PLATFORM_FEE_LABEL} per sale.`,
};

export const PRICING_CALCULATOR_PAGE: PublicPage = {
	path: '/pricing/calculator',
	title: 'Credits calculator',
	description: "Tell us how many stores you'll run and how you'll use the AI, and we'll estimate your monthly credits and recommend a plan.",
};

export const BLOG_PAGE: PublicPage = {
	path: '/blog',
	title: 'Blog',
	description: 'News from Estori: launches, guides for store owners and stories from creators.',
};

export const CONTACT_PAGE: PublicPage = {
	path: '/contact',
	title: 'Contact sales',
	description: "Tell the Estori team about your stores. We'll reply by email and help you pick the right plan.",
};

export function industryPage(industry: Industry): PublicPage {
	return {
		path: industryPath(industry.slug),
		title: industry.metaTitle,
		description: industry.metaDescription,
		image: industry.photo,
		structuredData: (origin) => industryStructuredData(industry, origin),
	};
}

export function blogPostPage(post: BlogPost): PublicPage {
	return { path: blogPostPath(post.slug), title: post.title, description: post.summary, lastModified: post.publishedAt };
}

export function legalPage(slug: LegalSlug): PublicPage {
	const { title } = LEGAL_DOCUMENTS[slug];
	return { path: `/${slug}`, title, description: `${title} for Estori.` };
}

/** Every public page, in the order the sitemap lists them. */
export const PUBLIC_PAGES: readonly PublicPage[] = [
	HOME_PAGE,
	BRANDS_PAGE,
	RESELLERS_PAGE,
	DIGITAL_PAGE,
	SUBSCRIPTIONS_PAGE,
	COMMUNITIES_PAGE,
	INDUSTRIES_HUB_PAGE,
	...INDUSTRIES.map(industryPage),
	AGENTIC_COMMERCE_PAGE,
	EMAIL_MARKETING_PAGE,
	WEB_ANALYTICS_PAGE,
	SEARCH_OPTIMIZATION_PAGE,
	DEVELOPERS_PAGE,
	CONTENT_CREATORS_PAGE,
	DISCOVER_PAGE,
	PRICING_PAGE,
	PRICING_CALCULATOR_PAGE,
	BLOG_PAGE,
	...BLOG_POSTS.map(blogPostPage),
	CONTACT_PAGE,
	...LEGAL_SLUGS.map(legalPage),
];

const PAGES_BY_PATH = new Map(PUBLIC_PAGES.map((page) => [page.path, page]));

/** The public page at a path; like the router, it ignores letter case and a trailing slash. */
export function findPublicPage(pathname: string): PublicPage | undefined {
	return PAGES_BY_PATH.get(pathname.replace(/\/+$/, '').toLowerCase() || '/');
}
