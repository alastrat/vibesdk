import { describe, expect, it } from 'vitest';
import { SELLER_STORIES } from '@/content/positioning';
import { AUDIENCES, CREATOR_ITEMS } from '@/lib/site-nav';

const sources = import.meta.glob<string>(
	[
		'/src/routes/landing/SellersBand.tsx',
		'/src/components/public-site/seller-art.tsx',
		'/src/components/public-site/shopper-mocks.tsx',
		'/src/components/public-site/art-kit.tsx',
		'/src/components/public-site/solution-page.tsx',
		'/src/content/positioning.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

const BAND = '/src/routes/landing/SellersBand.tsx';
const ART = '/src/components/public-site/seller-art.tsx';

describe('every kind of seller', () => {
	it('tells the story of the four sellers after brands, each linked to its page', () => {
		expect(SELLER_STORIES.map((seller) => seller.id)).toEqual(['resellers', 'digital', 'developers', 'creators']);
		const pages = [...AUDIENCES, ...CREATOR_ITEMS].map((item) => item.to);
		for (const seller of SELLER_STORIES) expect(pages).toContain(seller.to);
		expect(SELLER_STORIES.map((seller) => seller.to)).not.toContain('/solutions/brands');
	});

	it("states the developers' fee from the code", () => {
		const copy = source('/src/content/positioning.ts');
		expect(copy).toContain('${PLATFORM_FEE_LABEL}');
		expect(copy).not.toMatch(/7% \+ \$0\.60/);
	});

	it('pins the story on the left while the cards scroll, and dims the cards not in view', () => {
		const band = source(BAND);
		expect(band).toContain('lg:sticky lg:top-[calc(var(--public-header-h)+3rem)] lg:self-start');
		expect(band).toContain('data-seller={index}');
		expect(band).toContain("index === active ? 'opacity-100' : 'lg:opacity-40'");
		// A card becomes the active one as it crosses the middle of the window.
		expect(band).toContain("rootMargin: '-50% 0px -50% 0px'");
		expect(band).toContain('motion-reduce:transition-none');
	});

	it('lets the pictures shrink to a phone: both grids have one column that may be narrower than a picture', () => {
		const band = source(BAND);
		expect(band).toContain('mx-auto grid max-w-[1248px] grid-cols-1 ');
		expect(band).toContain('<div ref={listRef} className="grid grid-cols-1 ');
	});

	it('pins only the heading and the index on the left; the story shows in each card on phones', () => {
		const band = source(BAND);
		expect(band).toMatch(/<div aria-hidden className="mt-10 hidden lg:block">/);
		expect(band).not.toContain('current.story');
		expect(band).toContain("'mt-4 text-pretty text-public-muted lg:hidden'");
		expect(band).toContain('<TextLink to={seller.item.to}');
	});

	it('draws a moving picture for each seller with the shared art kit', () => {
		const art = source(ART);
		expect(art).toContain('export function SellerArt(');
		expect(art.match(/useStory<HTMLDivElement>\(/g)).toHaveLength(4);
		expect(art).toContain('<ArtCanvas');
		expect(art).toContain('sellerKeepsCents(EXAMPLE_SALE_CENTS)');
		expect(art).not.toMatch(/framer/);
		for (const text of ['Curated catalog', 'Instant download', 'North Ridge Coffee', 'Your link']) expect(art, text).toContain(text);
	});

	it('shares one art kit between the personalization and seller pictures', () => {
		const kit = source('/src/components/public-site/art-kit.tsx');
		for (const name of ['ArtCanvas', 'StoryFrame', 'Photo', 'Field', 'GreenRing']) expect(kit, name).toContain(`export function ${name}(`);
		for (const path of [ART, '/src/components/public-site/shopper-mocks.tsx']) {
			expect(source(path), path).toContain("from './art-kit'");
			expect(source(path), path).not.toContain('function Photo(');
		}
	});

	it('drops the old link cards, which nothing uses any more', () => {
		expect(source(BAND)).not.toContain('LinkCard');
		expect(source('/src/components/public-site/solution-page.tsx')).not.toContain('export function LinkCard');
	});
});
