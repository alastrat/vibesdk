import type { CardCopy } from './positioning';

/**
 * The verticals Estori speaks to, each with its own page. There is no catch-all "E-commerce" entry: every Estori store
 * is an online store, so each industry names a kind of seller instead.
 */
export interface Industry {
	slug: string;
	name: string;
	title: string;
	lead: string;
	/** What a seller in this industry might ask Estori for, in their own words. */
	prompts: readonly string[];
	/** What this industry's stores can include; each is something to ask Estori for. */
	features: readonly CardCopy[];
}

export const INDUSTRIES: readonly Industry[] = [
	{
		slug: 'beauty-personal-care',
		name: 'Beauty & Personal Care',
		title: 'An online store for your beauty brand, built in minutes',
		lead: 'Describe your products, shades and routines, and Estori builds a complete store that you keep shaping just by asking.',
		prompts: [
			'A clean skincare store with a morning and night routine builder, and an ingredient glossary.',
			'A nail polish shop where every shade has its own swatch and product page.',
			"A men's grooming store with starter kits and a how-to page for each product.",
		],
		features: [
			{ title: 'Shades and skin types', body: 'Ask for swatches, shade finders or skin-type filters, and Estori adds them to your catalog.' },
			{ title: 'Routines and kits', body: 'Group products into step-by-step routines and gift sets, each with its own page.' },
			{ title: 'Ingredients up front', body: 'Give every product a clear ingredients list and how-to-use notes.' },
		],
	},
	{
		slug: 'fashion-apparel',
		name: 'Fashion & Apparel',
		title: 'An online store for your clothing brand, built in minutes',
		lead: 'Describe your collections and your style, and Estori builds a complete store that you keep shaping just by asking.',
		prompts: [
			'A streetwear store with weekly drops, a lookbook and a size guide on every product.',
			'A sustainable basics brand with a page on materials and how each piece is made.',
			"A kids' clothing store organized by age, with back-to-school bundles.",
		],
		features: [
			{ title: 'Sizes and fit', body: 'Add size charts and fit notes to every product, and let shoppers pick size and color.' },
			{ title: 'Collections and drops', body: 'Organize products into seasonal collections, new arrivals and limited drops.' },
			{ title: 'Lookbooks', body: 'Show outfits on editorial pages that link to every piece in them.' },
		],
	},
	{
		slug: 'health-wellness',
		name: 'Health & Wellness',
		title: 'An online store for your wellness brand, built in minutes',
		lead: 'Describe your products and how people use them, and Estori builds a complete store that you keep shaping just by asking.',
		prompts: [
			"A supplements store with a page for each product's ingredients and suggested use.",
			'A yoga shop selling mats, props and gift cards, with a beginner guide.',
			'A herbal tea brand with blends organized by mood and time of day.',
		],
		features: [
			{ title: 'Clear product details', body: 'Give every product its ingredients, suggested use and questions, written in your voice.' },
			{ title: 'Starter sets', body: 'Pair products into starter sets and bundles, each with its own page.' },
			{ title: 'Guides that link to products', body: 'Add guides that explain your products and link straight to them.' },
		],
	},
	{
		slug: 'food-beverage',
		name: 'Food & Beverage',
		title: 'An online store for your food or drink brand, built in minutes',
		lead: 'Describe what you make and where it comes from, and Estori builds a complete store that you keep shaping just by asking.',
		prompts: [
			'A small-batch coffee roaster with single origins, tasting notes and a brewing guide.',
			'An artisan bakery taking pre-orders for weekend pickup.',
			'A hot sauce brand with heat levels, recipes and gift boxes.',
		],
		features: [
			{ title: 'Origins and tasting notes', body: "Tell each product's story: where it comes from, how it tastes and how to enjoy it." },
			{ title: 'Gift boxes and sets', body: 'Combine products into gift boxes and tasting sets.' },
			{ title: 'Recipes and guides', body: 'Add recipes and brewing guides that link to the products they use.' },
		],
	},
	{
		slug: 'home-living',
		name: 'Home & Living',
		title: 'An online store for your home goods brand, built in minutes',
		lead: 'Describe your pieces and the spaces they belong in, and Estori builds a complete store that you keep shaping just by asking.',
		prompts: [
			'A ceramics studio selling handmade mugs and vases, with a page about each glaze.',
			'A furniture store organized by room, with dimensions on every product.',
			'A candle brand with scents grouped by season and a gift guide.',
		],
		features: [
			{ title: 'Shop by room or style', body: 'Organize your catalog by room, style or material.' },
			{ title: 'Dimensions and care', body: 'Give every product its size, materials and care instructions.' },
			{ title: 'Gift guides', body: 'Curate gift guides and seasonal edits that link to your products.' },
		],
	},
	{
		slug: 'jewelry-accessories',
		name: 'Jewelry & Accessories',
		title: 'An online store for your jewelry brand, built in minutes',
		lead: 'Describe your pieces and the stories behind them, and Estori builds a complete store that you keep shaping just by asking.',
		prompts: [
			'A handmade jewelry store with collections by metal and a ring size guide.',
			'A watch boutique with detailed specs for every model.',
			'A leather bag brand with colors, materials and the story of each design.',
		],
		features: [
			{ title: 'Sizes and materials', body: 'Add ring size guides, metal options and material details to every piece.' },
			{ title: 'Collections with a story', body: 'Group pieces into collections, each with a page that tells its story.' },
			{ title: 'Ready to gift', body: 'Add gift sets and a gift guide for every occasion.' },
		],
	},
	{
		slug: 'sports-outdoors',
		name: 'Sports & Outdoors',
		title: 'An online store for your sports or outdoor brand, built in minutes',
		lead: 'Describe your gear and the people who use it, and Estori builds a complete store that you keep shaping just by asking.',
		prompts: [
			'A trail running store with gear organized by distance and terrain.',
			'A cycling shop with bikes, parts and a frame size guide.',
			'An outdoor gear brand with packing lists for every kind of trip.',
		],
		features: [
			{ title: 'Shop by activity', body: 'Organize gear by sport, terrain or level, so shoppers find what fits.' },
			{ title: 'Specs that matter', body: 'Show sizes, weights and materials on every product.' },
			{ title: 'Guides and checklists', body: 'Add packing lists and buying guides that link to your gear.' },
		],
	},
	{
		slug: 'pets',
		name: 'Pets',
		title: 'An online store for your pet brand, built in minutes',
		lead: 'Describe your products and the pets they are for, and Estori builds a complete store that you keep shaping just by asking.',
		prompts: [
			'A natural pet food store organized by animal and age.',
			'A dog accessories brand with collars, leads and a size guide by breed.',
			'A cat toy shop with bundles and a page for new cat owners.',
		],
		features: [
			{ title: 'Shop by pet', body: 'Organize products by animal, size and age.' },
			{ title: 'Size guides', body: 'Help owners pick the right collar, bed or harness with size guides.' },
			{ title: 'Starter kits', body: 'Bundle the essentials for new owners into starter kits.' },
		],
	},
];

export function industryPath(slug: string): string {
	return `/industries/${slug}`;
}

export function findIndustry(slug: string): Industry | undefined {
	return INDUSTRIES.find((industry) => industry.slug === slug);
}
