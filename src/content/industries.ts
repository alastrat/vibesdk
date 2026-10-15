import { pageTitle } from '@/brand/page-title';
import { SCHEMA_CONTEXT, absoluteUrl, breadcrumbList, faqPage, type Crumb, type JsonLdNode } from '@/lib/seo';
import { BRAND } from '../../shared/brand';
import { FREE_PLAN_ANSWER, PAYMENTS_ANSWER, type CardCopy, type FaqItem } from './positioning';

export type IndustrySlug =
	| 'beauty-personal-care'
	| 'fashion-apparel'
	| 'health-wellness'
	| 'food-beverage'
	| 'home-living'
	| 'jewelry-accessories'
	| 'sports-outdoors'
	| 'pets';

/** An Unsplash photo, saved in two widths: `src` at 1200px and a 640px copy beside it. */
export interface IndustryPhoto {
	src: string;
	alt: string;
	photographer: string;
	/** The photo's page on Unsplash, which the credit links to. */
	url: string;
}

/** A question with a plain-text answer, so it can go in structured data as well as on the page. */
export interface TextFaqItem extends FaqItem {
	answer: string;
}

/** The piece of a store drawn over a feature's photo: what a shopper would see once the feature is built. */
export type StorePreview =
	| { kind: 'swatches'; title: string; swatches: readonly string[]; selected: number; caption: string }
	| { kind: 'options'; title: string; options: readonly string[]; selected: number; caption?: string }
	| { kind: 'table'; title: string; rows: readonly (readonly [string, string])[] }
	| { kind: 'list'; title: string; items: readonly string[]; style: 'steps' | 'checks' | 'plain' }
	| { kind: 'bundle'; title: string; items: readonly string[]; price: string };

/** Something an industry's stores can include, as a slide of the page's carousel. */
export interface IndustryFeature extends CardCopy {
	/** What a seller would ask Estori for to get it, in their own words. */
	request: string;
	photo: IndustryPhoto;
	/** The slide's panel color, dark enough for white text. */
	accent: string;
	preview: StorePreview;
}

/**
 * The verticals Estori speaks to, each with its own page. There is no catch-all "E-commerce" entry: every Estori store
 * is an online store, so each industry names a kind of seller instead.
 */
export interface Industry {
	slug: IndustrySlug;
	name: string;
	/** Who the page is for, as in "What is Estori for beauty brands?". */
	audience: string;
	/** The kind of store, as in "What your beauty store can include". */
	store: string;
	title: string;
	lead: string;
	/** The search result title, before the brand name. */
	metaTitle: string;
	metaDescription: string;
	/** What Estori is for this industry, in a few sentences that search engines and AI assistants can quote whole. */
	summary: string;
	photo: IndustryPhoto;
	/** What a seller in this industry might ask Estori for, in their own words. */
	prompts: readonly string[];
	/** What this industry's stores can include; each is something to ask Estori for. */
	features: readonly IndustryFeature[];
	/** Questions only this industry asks; industryFaq adds the ones every industry shares. */
	questions: readonly TextFaqItem[];
}

export const INDUSTRIES_PATH = '/industries';

export const INDUSTRIES: readonly Industry[] = [
	{
		slug: 'beauty-personal-care',
		name: 'Beauty & Personal Care',
		audience: 'beauty brands',
		store: 'beauty store',
		title: 'An online store for your beauty brand, built in minutes',
		lead: 'Describe your products, shades and routines, and Estori builds a complete store that you keep shaping just by asking.',
		metaTitle: 'AI Online Store Builder for Beauty Brands',
		metaDescription:
			'Build an online store for your beauty or skincare brand with AI. Describe your products, shades and routines, and Estori builds it in minutes. Free to build.',
		summary:
			'Estori is an AI store builder for beauty and personal care brands. Describe your products, shades and routines in plain words, and Estori builds a complete online store with a catalog, product pages, cart and checkout flow. You can then add swatches, routine builders or ingredient lists just by asking, without writing code.',
		photo: {
			src: '/marketing/industries/beauty-personal-care.webp',
			alt: "Skincare bottles and a jar of cream on a wooden block, against a peach wall with baby's breath",
			photographer: 'Neauthy Skincare',
			url: 'https://unsplash.com/photos/white-and-brown-plastic-bottles-8ZKwW-2SR28',
		},
		prompts: [
			'A clean skincare store with a morning and night routine builder, and an ingredient glossary.',
			'A nail polish shop where every shade has its own swatch and product page.',
			"A men's grooming store with starter kits and a how-to page for each product.",
		],
		features: [
			{
				title: 'Shades and skin types',
				body: 'Ask for swatches, shade finders or skin-type filters, and Estori adds them to your catalog.',
				request: 'Add a shade finder that matches each foundation to warm, cool or neutral undertones.',
				photo: {
					src: '/marketing/industries/features/beauty-personal-care-shades.webp',
					alt: 'Makeup brushes beside an open eyeshadow palette in warm shades on a grey surface',
					photographer: 'Kelly Sikkema',
					url: 'https://unsplash.com/photos/brown-and-black-makeup-palette-47x_lN_VAFw',
				},
				accent: '#4a3b35',
				preview: { kind: 'swatches', title: 'Find your shade', swatches: ['#f3d6c1', '#e8bf9f', '#d4a07a', '#b9825c', '#8d5a3b', '#5e3a26'], selected: 2, caption: '3W: medium, warm undertone' },
			},
			{
				title: 'Routines and kits',
				body: 'Group products into step-by-step routines and gift sets, each with its own page.',
				request: 'Build a night routine page that walks through cleanser, serum and moisturizer, with each product linked.',
				photo: {
					src: '/marketing/industries/features/beauty-personal-care-routines.webp',
					alt: 'Drops of serum, oil and cream on a peach background with green leaves',
					photographer: 'ibnu ihza',
					url: 'https://unsplash.com/photos/skincare-products-with-leaves-on-a-light-background-g6q3lFAe3kA',
				},
				accent: '#2f5a3f',
				preview: { kind: 'list', title: 'Night routine', items: ['Gentle cleanser', 'Vitamin C serum', 'Barrier cream'], style: 'steps' },
			},
			{
				title: 'Ingredients up front',
				body: 'Give every product a clear ingredients list and how-to-use notes.',
				request: "Show every product's full ingredients list, with a short note on what each key ingredient does.",
				photo: {
					src: '/marketing/industries/features/beauty-personal-care-ingredients.webp',
					alt: 'An amber glass dropper bottle with a blank label standing on a concrete block',
					photographer: 'Avtar Singh',
					url: 'https://unsplash.com/photos/amber-glass-dropper-bottle-with-blank-label-on-concrete-block-MkuwnDkT1s0',
				},
				accent: '#6a3f1d',
				preview: { kind: 'table', title: 'Key ingredients', rows: [['Niacinamide', 'Evens tone'], ['Hyaluronic acid', 'Holds moisture'], ['Squalane', 'Softens skin']] },
			},
		],
		questions: [
			{
				question: 'Can I show shades, swatches and ingredients on my products?',
				answer: 'Yes. Ask for shade swatches, a shade finder, skin-type filters or a full ingredients list with how-to-use notes, and Estori adds them to your product pages.',
			},
			{
				question: 'Can I sell routines and gift sets?',
				answer: 'Yes. Ask Estori to group products into step-by-step routines, starter kits or gift sets, each with its own page that links to every product in it.',
			},
		],
	},
	{
		slug: 'fashion-apparel',
		name: 'Fashion & Apparel',
		audience: 'fashion brands',
		store: 'clothing store',
		title: 'An online store for your clothing brand, built in minutes',
		lead: 'Describe your collections and your style, and Estori builds a complete store that you keep shaping just by asking.',
		metaTitle: 'AI Online Store Builder for Fashion Brands',
		metaDescription:
			'Build an online store for your fashion or clothing brand with AI. Describe your collections, sizes and drops, and Estori builds it in minutes. Free to build.',
		summary:
			'Estori is an AI store builder for fashion and clothing brands. Describe your collections, sizes and style in plain words, and Estori builds a complete online store with a catalog, product pages, cart and checkout flow. You can then add size guides, lookbooks or limited drops just by asking, without writing code.',
		photo: {
			src: '/marketing/industries/fashion-apparel.webp',
			alt: 'Inside a clothing boutique, with shirts and jackets on hanging rails under pendant lamps',
			photographer: 'Clark Street Mercantile',
			url: 'https://unsplash.com/photos/clothing-boutique-interior-with-hanging-racks-qnKhZJPKFD8',
		},
		prompts: [
			'A streetwear store with weekly drops, a lookbook and a size guide on every product.',
			'A sustainable basics brand with a page on materials and how each piece is made.',
			"A kids' clothing store organized by age, with back-to-school bundles.",
		],
		features: [
			{
				title: 'Sizes and fit',
				body: 'Add size charts and fit notes to every product, and let shoppers pick size and color.',
				request: 'Add a size chart and fit notes to every product, and let shoppers pick a size and color before adding to cart.',
				photo: {
					src: '/marketing/industries/features/fashion-apparel-sizes.webp',
					alt: 'Two cloth measuring tapes lying on a bright pink surface',
					photographer: 'Ekaterina Grosheva',
					url: 'https://unsplash.com/photos/a-group-of-measuring-tape-sitting-on-top-of-a-pink-surface-F9_xTexVoME',
				},
				accent: '#7a1f45',
				preview: { kind: 'options', title: 'Size', options: ['XS', 'S', 'M', 'L', 'XL'], selected: 2, caption: 'Fits true to size. Model wears M.' },
			},
			{
				title: 'Collections and drops',
				body: 'Organize products into seasonal collections, new arrivals and limited drops.',
				request: "Create a page for Friday's drop with a countdown, and move it to New arrivals when it goes live.",
				photo: {
					src: '/marketing/industries/features/fashion-apparel-drops.webp',
					alt: 'Five jackets and a hat hanging on a clothing rack against a white wall',
					photographer: 'Amanda Vick',
					url: 'https://unsplash.com/photos/one-cowboy-hat-and-five-jackets-hanged-on-clothes-rack-ohWf6YuzOQk',
				},
				accent: '#3d3f4a',
				preview: { kind: 'list', title: 'Drop 04, Friday at 10am', items: ['Waxed field jacket', 'Denim overshirt', 'Wool chore coat'], style: 'plain' },
			},
			{
				title: 'Lookbooks',
				body: 'Show outfits on editorial pages that link to every piece in them.',
				request: 'Make a spring lookbook where every outfit links to each piece in it.',
				photo: {
					src: '/marketing/industries/features/fashion-apparel-lookbooks.webp',
					alt: 'A woman with braided hair in a red outfit sitting against a clear blue sky',
					photographer: 'Marjan Taghipour',
					url: 'https://unsplash.com/photos/woman-in-red-outfit-against-sky-1tjMpBTvFAA',
				},
				accent: '#1f3a6e',
				preview: { kind: 'list', title: 'Shop the look', items: ['Red linen set', 'Gold hoops', 'Canvas sneakers'], style: 'plain' },
			},
		],
		questions: [
			{
				question: 'Can I add size charts and fit notes?',
				answer: 'Yes. Ask for a size chart and fit notes on every product, with size and color options that shoppers pick before adding to the cart.',
			},
			{
				question: 'Can I run drops and lookbooks?',
				answer: 'Yes. Ask Estori for seasonal collections, a new arrivals page, limited drops and editorial lookbooks that link to every piece in them.',
			},
		],
	},
	{
		slug: 'health-wellness',
		name: 'Health & Wellness',
		audience: 'wellness brands',
		store: 'wellness store',
		title: 'An online store for your wellness brand, built in minutes',
		lead: 'Describe your products and how people use them, and Estori builds a complete store that you keep shaping just by asking.',
		metaTitle: 'AI Online Store Builder for Wellness Brands',
		metaDescription:
			'Build an online store for your wellness brand with AI. Describe your supplements, teas or yoga gear, and Estori builds it in minutes. Free to build.',
		summary:
			'Estori is an AI store builder for health and wellness brands. Describe your supplements, teas, yoga gear or self-care products in plain words, and Estori builds a complete online store with a catalog, product pages, cart and checkout flow. You can then add ingredient pages, starter sets or guides just by asking, without writing code.',
		photo: {
			src: '/marketing/industries/health-wellness.webp',
			alt: 'Scented candles, lotions and reed diffusers lined up on a white shelf',
			photographer: 'shawn kim',
			url: 'https://unsplash.com/photos/white-candles-lotions-and-diffusers-displayed-on-a-shelf-auZY3byMjig',
		},
		prompts: [
			"A supplements store with a page for each product's ingredients and suggested use.",
			'A yoga shop selling mats, props and gift cards, with a beginner guide.',
			'A herbal tea brand with blends organized by mood and time of day.',
		],
		features: [
			{
				title: 'Clear product details',
				body: 'Give every product its ingredients, suggested use and questions, written in your voice.',
				request: 'Give each supplement a facts table, suggested use and answers to common questions.',
				photo: {
					src: '/marketing/industries/features/health-wellness-details.webp',
					alt: 'Beige capsules spilled from a white bottle beside green pine needles',
					photographer: 'Supliful',
					url: 'https://unsplash.com/photos/beige-capsules-and-pine-needles-UTPZnnEVW4E',
				},
				accent: '#35503a',
				preview: { kind: 'table', title: 'Supplement facts', rows: [['Serving', '2 capsules'], ['Magnesium', '200 mg'], ['Vitamin D3', '25 mcg']] },
			},
			{
				title: 'Starter sets',
				body: 'Pair products into starter sets and bundles, each with its own page.',
				request: 'Bundle a mat, a block and a towel into a yoga starter set with its own page.',
				photo: {
					src: '/marketing/industries/features/health-wellness-sets.webp',
					alt: 'A pink yoga block, two small dumbbells and a towel on a pink exercise mat',
					photographer: 'Elena Kloppenburg',
					url: 'https://unsplash.com/photos/pink-dumbbell-on-pink-textile-erUC4fTtCuo',
				},
				accent: '#7a2a3a',
				preview: { kind: 'bundle', title: 'Yoga starter set', items: ['Cork block', 'Non-slip mat', 'Microfiber towel'], price: 'Save 15%' },
			},
			{
				title: 'Guides that link to products',
				body: 'Add guides that explain your products and link straight to them.',
				request: 'Write an evening tea guide that suggests a blend for each mood and links to it.',
				photo: {
					src: '/marketing/industries/features/health-wellness-guides.webp',
					alt: 'A cup of tea on a saucer beside an open book and white flowers',
					photographer: 'Thought Catalog',
					url: 'https://unsplash.com/photos/white-cup-with-saucer-near-bok-OJZB0VUQKKc',
				},
				accent: '#4a3f5a',
				preview: { kind: 'list', title: 'Evening tea guide', items: ['To wind down: chamomile', 'To feel calm: lemon balm', 'To sleep: lavender'], style: 'plain' },
			},
		],
		questions: [
			{
				question: 'Can I list ingredients and suggested use on every product?',
				answer: "Yes. Ask Estori to give each product its ingredients, suggested use and common questions, written in your brand's voice.",
			},
			{
				question: 'Can I sell bundles and starter sets?',
				answer: 'Yes. Ask Estori to pair products into starter sets and bundles, each with its own page, and to add guides that link straight to them.',
			},
		],
	},
	{
		slug: 'food-beverage',
		name: 'Food & Beverage',
		audience: 'food and drink brands',
		store: 'food and drink store',
		title: 'An online store for your food or drink brand, built in minutes',
		lead: 'Describe what you make and where it comes from, and Estori builds a complete store that you keep shaping just by asking.',
		metaTitle: 'AI Online Store Builder for Food & Drink Brands',
		metaDescription:
			'Build an online store for your food or drink brand with AI. Describe your coffee, baked goods or sauces, and Estori builds it in minutes. Free to build.',
		summary:
			'Estori is an AI store builder for food and drink brands. Describe what you make and where it comes from in plain words, and Estori builds a complete online store with a catalog, product pages, cart and checkout flow. You can then add tasting notes, gift boxes or recipes just by asking, without writing code.',
		photo: {
			src: '/marketing/industries/food-beverage.webp',
			alt: 'A coffee roaster pouring freshly roasted beans into the cooling tray of a roasting machine',
			photographer: 'Yanapi Senaud',
			url: 'https://unsplash.com/photos/person-pouring-coffee-beans-on-a-machine-6HR8vpjYUHo',
		},
		prompts: [
			'A small-batch coffee roaster with single origins, tasting notes and a brewing guide.',
			'An artisan bakery taking pre-orders for weekend pickup.',
			'A hot sauce brand with heat levels, recipes and gift boxes.',
		],
		features: [
			{
				title: 'Origins and tasting notes',
				body: "Tell each product's story: where it comes from, how it tastes and how to enjoy it.",
				request: "Show each coffee's origin, roast and tasting notes at the top of its page.",
				photo: {
					src: '/marketing/industries/features/food-beverage-origins.webp',
					alt: 'A scoop of roasted coffee beans beside a burlap sack full of beans',
					photographer: 'Sergey Kotenev',
					url: 'https://unsplash.com/photos/a-scoop-full-of-coffee-beans-next-to-a-sack-of-coffee-beans-Qx_S2YE5I1o',
				},
				accent: '#5a3a24',
				preview: { kind: 'table', title: 'Huila, Colombia', rows: [['Process', 'Washed'], ['Roast', 'Medium'], ['Notes', 'Cocoa, cherry']] },
			},
			{
				title: 'Gift boxes and sets',
				body: 'Combine products into gift boxes and tasting sets.',
				request: 'Create a tasting box with three single origins and a brewing guide, sold as one product.',
				photo: {
					src: '/marketing/industries/features/food-beverage-gifts.webp',
					alt: 'A wooden crate lined with linen, holding jars of preserves tied with paper tags',
					photographer: 'Dmitry Mashkin',
					url: 'https://unsplash.com/photos/brown-wooden-box-N5fp98wt6h8',
				},
				accent: '#6a4a2a',
				preview: { kind: 'bundle', title: 'Tasting box', items: ['Three single origins', 'Brewing guide', 'Gift note'], price: '$48' },
			},
			{
				title: 'Recipes and guides',
				body: 'Add recipes and brewing guides that link to the products they use.',
				request: 'Add a pour-over guide with brewing times for each step, linked to the beans it uses.',
				photo: {
					src: '/marketing/industries/features/food-beverage-recipes.webp',
					alt: 'A pour-over coffee dripper on a digital scale beside a kettle and a scoop',
					photographer: 'Jason An',
					url: 'https://unsplash.com/photos/a-cup-of-coffee-sitting-on-top-of-a-scale-S9QYhiZ0tFE',
				},
				accent: '#2f2a28',
				preview: { kind: 'list', title: 'Pour-over guide', items: ['18 g coffee, medium-fine', '300 g water at 94 °C', 'Pour in three stages'], style: 'steps' },
			},
		],
		questions: [
			{
				question: 'Can I share tasting notes and where my products come from?',
				answer: "Yes. Ask Estori to tell each product's story on its page, from where it comes from to how it tastes and how to enjoy it, with recipes or brewing guides that link back to it.",
			},
			{
				question: 'Can I sell gift boxes and tasting sets?',
				answer: 'Yes. Ask Estori to combine products into gift boxes and tasting sets, each with its own page.',
			},
		],
	},
	{
		slug: 'home-living',
		name: 'Home & Living',
		audience: 'home goods brands',
		store: 'home goods store',
		title: 'An online store for your home goods brand, built in minutes',
		lead: 'Describe your pieces and the spaces they belong in, and Estori builds a complete store that you keep shaping just by asking.',
		metaTitle: 'AI Online Store Builder for Home Goods Brands',
		metaDescription:
			'Build an online store for your home goods or decor brand with AI. Describe your furniture, ceramics or candles, and Estori builds it in minutes. Free to build.',
		summary:
			'Estori is an AI store builder for home goods and decor brands. Describe your furniture, ceramics, candles or textiles in plain words, and Estori builds a complete online store with a catalog, product pages, cart and checkout flow. You can then organize it by room, add dimensions and care notes, or curate gift guides just by asking, without writing code.',
		photo: {
			src: '/marketing/industries/home-living.webp',
			alt: 'A row of handmade ceramic vases in cream, white and brown glazes on a wooden shelf',
			photographer: 'Chloe Bolton',
			url: 'https://unsplash.com/photos/ceramic-vases-on-wooden-surface-R0qthXq3jec',
		},
		prompts: [
			'A ceramics studio selling handmade mugs and vases, with a page about each glaze.',
			'A furniture store organized by room, with dimensions on every product.',
			'A candle brand with scents grouped by season and a gift guide.',
		],
		features: [
			{
				title: 'Shop by room or style',
				body: 'Organize your catalog by room, style or material.',
				request: 'Organize the catalog by room, with pages for the living room, bedroom, dining room and office.',
				photo: {
					src: '/marketing/industries/features/home-living-rooms.webp',
					alt: 'A bright living room with a white sofa, round mirrors and a soft rug',
					photographer: 'Spacejoy',
					url: 'https://unsplash.com/photos/a-living-room-filled-with-furniture-and-a-mirror-c0JoR_-2x3E',
				},
				accent: '#6a5236',
				preview: { kind: 'options', title: 'Shop by room', options: ['Living', 'Bedroom', 'Dining', 'Office'], selected: 0 },
			},
			{
				title: 'Dimensions and care',
				body: 'Give every product its size, materials and care instructions.',
				request: "Show each chair's height, seat height and materials in the same table on every product page.",
				photo: {
					src: '/marketing/industries/features/home-living-dimensions.webp',
					alt: 'A light wooden chair standing alone against a pale lilac background',
					photographer: 'Hongly Oung',
					url: 'https://unsplash.com/photos/a-wooden-chair-on-a-white-background-iBxQvOLuKb4',
				},
				accent: '#5a4a66',
				preview: { kind: 'table', title: 'Dimensions', rows: [['Height', '79 cm'], ['Seat height', '45 cm'], ['Material', 'Solid oak']] },
			},
			{
				title: 'Gift guides',
				body: 'Curate gift guides and seasonal edits that link to your products.',
				request: 'Curate a holiday page of gifts under $50.',
				photo: {
					src: '/marketing/industries/features/home-living-gifts.webp',
					alt: 'A gift wrapped in pink tissue paper and tied with a pale blue ribbon',
					photographer: 'Katie Goertzen',
					url: 'https://unsplash.com/photos/a-wrapped-present-with-a-blue-ribbon-on-a-white-background-8oMwa5Ofz4Q',
				},
				accent: '#3a5a6e',
				preview: { kind: 'list', title: 'Gifts under $50', items: ['Linen napkins', 'Soy candle', 'Stoneware mug'], style: 'plain' },
			},
		],
		questions: [
			{
				question: 'Can shoppers browse by room or style?',
				answer: 'Yes. Ask Estori to organize your catalog by room, style or material, so shoppers find pieces for the space they are furnishing.',
			},
			{
				question: 'Can I add dimensions and care instructions?',
				answer: 'Yes. Ask Estori to give every product its size, materials and care instructions, laid out the same way on every page.',
			},
		],
	},
	{
		slug: 'jewelry-accessories',
		name: 'Jewelry & Accessories',
		audience: 'jewelry brands',
		store: 'jewelry store',
		title: 'An online store for your jewelry brand, built in minutes',
		lead: 'Describe your pieces and the stories behind them, and Estori builds a complete store that you keep shaping just by asking.',
		metaTitle: 'AI Online Store Builder for Jewelry Brands',
		metaDescription:
			'Build an online store for your jewelry or accessories brand with AI. Describe your pieces, metals and sizes, and Estori builds it in minutes. Free to build.',
		summary:
			'Estori is an AI store builder for jewelry and accessories brands. Describe your pieces, metals and the stories behind them in plain words, and Estori builds a complete online store with a catalog, product pages, cart and checkout flow. You can then add ring size guides, collections or gift sets just by asking, without writing code.',
		photo: {
			src: '/marketing/industries/jewelry-accessories.webp',
			alt: 'A diamond engagement ring with a rose gold halo resting on a black box',
			photographer: 'Sabrianna',
			url: 'https://unsplash.com/photos/silver-diamond-ring-on-black-box-Y_bxfTa_iUA',
		},
		prompts: [
			'A handmade jewelry store with collections by metal and a ring size guide.',
			'A watch boutique with detailed specs for every model.',
			'A leather bag brand with colors, materials and the story of each design.',
		],
		features: [
			{
				title: 'Sizes and materials',
				body: 'Add ring size guides, metal options and material details to every piece.',
				request: 'Add a ring size guide, and let shoppers choose gold or silver on every ring.',
				photo: {
					src: '/marketing/industries/features/jewelry-accessories-sizes.webp',
					alt: 'A hand wearing several silver rings against a soft, sunlit field',
					photographer: 'Maddi Bazzocco',
					url: 'https://unsplash.com/photos/selective-focus-photo-of-persons-hand-with-five-rings-lk7s8i5NdqE',
				},
				accent: '#6e3f3a',
				preview: { kind: 'options', title: 'Ring size', options: ['5', '6', '7', '8', '9'], selected: 2, caption: '14k gold or sterling silver' },
			},
			{
				title: 'Collections with a story',
				body: 'Group pieces into collections, each with a page that tells its story.',
				request: 'Give the Initials collection its own page, with the story behind it.',
				photo: {
					src: '/marketing/industries/features/jewelry-accessories-collections.webp',
					alt: 'Gold necklaces with initial pendants hanging against a black background',
					photographer: 'Zayed Ahmed Zadu',
					url: 'https://unsplash.com/photos/several-gold-necklaces-with-initial-pendants-displayed-A-OEreql4AU',
				},
				accent: '#3a2f1a',
				preview: { kind: 'list', title: 'The Initials collection', items: ['Letter pendant', 'Fine gold chain', 'Engraved clasp'], style: 'plain' },
			},
			{
				title: 'Ready to gift',
				body: 'Add gift sets and a gift guide for every occasion.',
				request: 'Offer gift wrapping and a handwritten note on every necklace.',
				photo: {
					src: '/marketing/industries/features/jewelry-accessories-gifts.webp',
					alt: 'A pearl necklace laid in an open red jewelry box',
					photographer: 'Cornelia Ng',
					url: 'https://unsplash.com/photos/white-pearl-necklace-with-box-2zHQhfEpisc',
				},
				accent: '#6e1f2a',
				preview: { kind: 'bundle', title: 'Gift set', items: ['Pearl necklace', 'Gift box', 'Handwritten note'], price: '$120' },
			},
		],
		questions: [
			{
				question: 'Can I add a ring size guide and metal options?',
				answer: 'Yes. Ask for a ring size guide, metal and stone options, and material details on every piece, and Estori adds them to your product pages.',
			},
			{
				question: 'Can each collection tell its own story?',
				answer: 'Yes. Ask Estori to group pieces into collections, each with a page that tells the story behind it, and to add gift sets and a gift guide.',
			},
		],
	},
	{
		slug: 'sports-outdoors',
		name: 'Sports & Outdoors',
		audience: 'sports and outdoor brands',
		store: 'sports and outdoor store',
		title: 'An online store for your sports or outdoor brand, built in minutes',
		lead: 'Describe your gear and the people who use it, and Estori builds a complete store that you keep shaping just by asking.',
		metaTitle: 'AI Online Store Builder for Sports & Outdoor Brands',
		metaDescription:
			'Build an online store for your sports or outdoor brand with AI. Describe your gear and who it is for, and Estori builds it in minutes. Free to build.',
		summary:
			'Estori is an AI store builder for sports and outdoor brands. Describe your gear and the people who use it in plain words, and Estori builds a complete online store with a catalog, product pages, cart and checkout flow. You can then organize gear by activity, add specs and size guides, or publish packing lists just by asking, without writing code.',
		photo: {
			src: '/marketing/industries/sports-outdoors.webp',
			alt: 'Two hikers with backpacks walking a trail toward snowy mountain peaks',
			photographer: 'Toomas Tartes',
			url: 'https://unsplash.com/photos/hikers-on-trail-toward-mountain-peaks-Yizrl9N_eDA',
		},
		prompts: [
			'A trail running store with gear organized by distance and terrain.',
			'A cycling shop with bikes, parts and a frame size guide.',
			'An outdoor gear brand with packing lists for every kind of trip.',
		],
		features: [
			{
				title: 'Shop by activity',
				body: 'Organize gear by sport, terrain or level, so shoppers find what fits.',
				request: 'Organize the running shoes by terrain: road, trail and mountain.',
				photo: {
					src: '/marketing/industries/features/sports-outdoors-activity.webp',
					alt: 'A runner in red on a forest trail between tall pine trees',
					photographer: 'Hendrik Morkel',
					url: 'https://unsplash.com/photos/a-man-in-red-running-through-a-forest-PEuBo_tBHDw',
				},
				accent: '#2f4a2a',
				preview: { kind: 'options', title: 'Shop by terrain', options: ['Road', 'Trail', 'Mountain'], selected: 1 },
			},
			{
				title: 'Specs that matter',
				body: 'Show sizes, weights and materials on every product.',
				request: 'Show weight, materials and sole in a specs table on every boot.',
				photo: {
					src: '/marketing/industries/features/sports-outdoors-specs.webp',
					alt: 'A pair of worn brown leather hiking boots on a rug',
					photographer: 'Glenn Carstens-Peters',
					url: 'https://unsplash.com/photos/brown-leather-lace-up-boots-s8TQiOfGlz0',
				},
				accent: '#5a3f2a',
				preview: { kind: 'table', title: 'Specs', rows: [['Weight', '540 g per boot'], ['Upper', 'Full-grain leather'], ['Sole', 'Lugged rubber']] },
			},
			{
				title: 'Guides and checklists',
				body: 'Add packing lists and buying guides that link to your gear.',
				request: 'Publish a weekend hike checklist that links to every item on it.',
				photo: {
					src: '/marketing/industries/features/sports-outdoors-guides.webp',
					alt: 'Two hiking backpacks with red sleeping mats on the grass below colorful hills',
					photographer: 'S&B Vonlanthen',
					url: 'https://unsplash.com/photos/hiking-backpacks-on-grass-with-mountains-background-D75_5tWZDQ4',
				},
				accent: '#234a6e',
				preview: { kind: 'list', title: 'Weekend hike checklist', items: ['30 L backpack', 'Rain shell', 'Water filter'], style: 'checks' },
			},
		],
		questions: [
			{
				question: 'Can shoppers find gear by sport or terrain?',
				answer: 'Yes. Ask Estori to organize your gear by sport, terrain or level, so shoppers find what fits the way they run, ride or climb.',
			},
			{
				question: 'Can I show specs and size guides?',
				answer: 'Yes. Ask Estori to show sizes, weights and materials on every product, and to add size guides such as a frame size chart.',
			},
		],
	},
	{
		slug: 'pets',
		name: 'Pets',
		audience: 'pet brands',
		store: 'pet store',
		title: 'An online store for your pet brand, built in minutes',
		lead: 'Describe your products and the pets they are for, and Estori builds a complete store that you keep shaping just by asking.',
		metaTitle: 'AI Online Store Builder for Pet Brands',
		metaDescription:
			'Build an online store for your pet brand with AI. Describe your pet food, toys and accessories, and Estori builds it in minutes. Free to build.',
		summary:
			'Estori is an AI store builder for pet brands and pet shops. Describe your food, toys and accessories and the pets they are for, and Estori builds a complete online store with a catalog, product pages, cart and checkout flow. You can then organize products by animal, size and age, or bundle starter kits just by asking, without writing code.',
		photo: {
			src: '/marketing/industries/pets.webp',
			alt: 'A fluffy dog on a teal leash sitting beside its owner against a yellow wall',
			photographer: 'Romain B',
			url: 'https://unsplash.com/photos/a-person-holding-a-dog-on-a-leash-oBUG8nbUGp4',
		},
		prompts: [
			'A natural pet food store organized by animal and age.',
			'A dog accessories brand with collars, leads and a size guide by breed.',
			'A cat toy shop with bundles and a page for new cat owners.',
		],
		features: [
			{
				title: 'Shop by pet',
				body: 'Organize products by animal, size and age.',
				request: 'Let owners shop by pet, with separate pages for dogs, cats and small pets.',
				photo: {
					src: '/marketing/industries/features/pets-shop.webp',
					alt: 'A tabby cat and a black and white puppy lying together in the grass',
					photographer: 'Andrew S',
					url: 'https://unsplash.com/photos/a-dog-and-a-cat-laying-in-the-grass-ouo1hbizWwo',
				},
				accent: '#3a5a2a',
				preview: { kind: 'options', title: 'Shop by pet', options: ['Dogs', 'Cats', 'Small pets'], selected: 0 },
			},
			{
				title: 'Size guides',
				body: 'Help owners pick the right collar, bed or harness with size guides.',
				request: 'Add a harness size guide that goes by chest size.',
				photo: {
					src: '/marketing/industries/features/pets-sizes.webp',
					alt: 'A cream-colored dog in a black harness on a lead beside a lake',
					photographer: 'Victoria V',
					url: 'https://unsplash.com/photos/a-white-dog-wearing-a-black-harness-by-a-body-of-water-tPl0PqaFBvQ',
				},
				accent: '#2f4a46',
				preview: { kind: 'table', title: 'Harness sizes', rows: [['S', 'Chest 35–45 cm'], ['M', 'Chest 45–60 cm'], ['L', 'Chest 60–80 cm']] },
			},
			{
				title: 'Starter kits',
				body: 'Bundle the essentials for new owners into starter kits.',
				request: 'Bundle a toy, a chew rope and starter food into a new puppy kit.',
				photo: {
					src: '/marketing/industries/features/pets-kits.webp',
					alt: 'A white and brown puppy holding a plush toy among other soft toys',
					photographer: 'marieke koenders',
					url: 'https://unsplash.com/photos/white-and-brown-short-coated-dog-on-brown-bear-plush-toy--Elf7vDV7Rk',
				},
				accent: '#6a4a2a',
				preview: { kind: 'bundle', title: 'New puppy kit', items: ['Plush toy', 'Chew rope', 'Starter food'], price: 'Save 20%' },
			},
		],
		questions: [
			{
				question: 'Can shoppers shop by pet, size and age?',
				answer: 'Yes. Ask Estori to organize products by animal, size and age, so owners find what fits their pet.',
			},
			{
				question: 'Can I add size guides for collars and harnesses?',
				answer: 'Yes. Ask for size guides by breed or measurement for collars, beds and harnesses, and for starter kits that bundle the essentials for new owners.',
			},
		],
	},
];

/** The page that lists every industry. */
export const INDUSTRIES_PAGE = {
	metaTitle: 'AI Online Store Builder for Every Industry',
	metaDescription:
		'See what Estori builds for beauty, fashion, wellness, food, home, jewelry, sports and pet brands. Describe your store and it is ready in minutes. Free to build.',
	title: 'An online store for whatever you sell',
	lead: 'Pick your industry to see the stores Estori builds for it, or describe your own and start now.',
} as const;

export const INDUSTRIES_CRUMBS: readonly Crumb[] = [
	{ name: 'Home', path: '/' },
	{ name: 'Industries', path: INDUSTRIES_PATH },
];

export function industryPath(slug: string): string {
	return `${INDUSTRIES_PATH}/${slug}`;
}

export function findIndustry(slug: string): Industry | undefined {
	return INDUSTRIES.find((industry) => industry.slug === slug);
}

/** Both widths of a photo, for an img srcSet. */
export function industryPhotoSrcSet(photo: IndustryPhoto): string {
	return `${photo.src.replace(/\.webp$/, '-640.webp')} 640w, ${photo.src} 1200w`;
}

export function industryCrumbs(industry: Industry): readonly Crumb[] {
	return [...INDUSTRIES_CRUMBS, { name: industry.name, path: industryPath(industry.slug) }];
}

/** An industry's own questions, then the ones every seller asks, worded for its kind of store. */
export function industryFaq(industry: Industry): readonly TextFaqItem[] {
	return [
		...industry.questions,
		{ question: `How much does it cost to build a ${industry.store} with Estori?`, answer: `Nothing to start. ${FREE_PLAN_ANSWER}` },
		{
			question: `Can I start my ${industry.store} from a template?`,
			answer: 'Yes. Discover lists stores built with Estori. Pick one close to what you have in mind, get your own copy, and adapt it to your products by asking for changes.',
		},
		{ question: `Can my ${industry.store} take payments?`, answer: PAYMENTS_ANSWER },
	];
}

/** Estori, as the software every industry page is about: in the browser, and free to start. */
const ESTORI_APP: JsonLdNode = {
	'@type': 'SoftwareApplication',
	name: BRAND.name,
	applicationCategory: 'BusinessApplication',
	operatingSystem: 'Web',
	offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
};

/** Structured data for an industry page: the page and its photo, its breadcrumb trail and its questions. */
export function industryStructuredData(industry: Industry, origin: string): JsonLdNode {
	const url = absoluteUrl(industryPath(industry.slug), origin);
	return {
		'@context': SCHEMA_CONTEXT,
		'@graph': [
			{
				'@type': 'WebPage',
				'@id': url,
				url,
				name: pageTitle(industry.metaTitle),
				description: industry.metaDescription,
				primaryImageOfPage: {
					'@type': 'ImageObject',
					url: absoluteUrl(industry.photo.src, origin),
					caption: industry.photo.alt,
					creditText: `${industry.photo.photographer} on Unsplash`,
					license: 'https://unsplash.com/license',
				},
				about: ESTORI_APP,
			},
			breadcrumbList(industryCrumbs(industry), origin),
			faqPage(industryFaq(industry)),
		],
	};
}

/** Structured data for the page that lists every industry. */
export function industriesStructuredData(origin: string): JsonLdNode {
	const url = absoluteUrl(INDUSTRIES_PATH, origin);
	return {
		'@context': SCHEMA_CONTEXT,
		'@graph': [
			{
				'@type': 'CollectionPage',
				'@id': url,
				url,
				name: pageTitle(INDUSTRIES_PAGE.metaTitle),
				description: INDUSTRIES_PAGE.metaDescription,
				about: ESTORI_APP,
			},
			breadcrumbList(INDUSTRIES_CRUMBS, origin),
			{
				'@type': 'ItemList',
				itemListElement: INDUSTRIES.map((industry, index) => ({
					'@type': 'ListItem',
					position: index + 1,
					name: industry.name,
					url: absoluteUrl(industryPath(industry.slug), origin),
				})),
			},
		],
	};
}
