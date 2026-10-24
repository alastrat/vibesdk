import { describe, expect, it } from 'vitest';
import {
	filterShowcase,
	shouldShowShowcase,
	showcaseFilterLabel,
	showcaseFilters,
	showcaseLayout,
	SHOWCASE_MOVING_MIN,
	storesWithImages,
	toShowcaseStore,
	type ShowcaseSource,
} from './showcase';

const base: ShowcaseSource = {
	id: 'north-ridge',
	title: 'North Ridge Coffee Store',
	category: 'store',
	priceCents: 2900,
	userName: 'Estori Team',
	screenshotUrl: '/api/screenshots/north-ridge/latest.png?token=a',
	showcaseScreenshotUrl: '/api/screenshots/north-ridge/showcase.jpg?token=a',
};

function store(overrides: Partial<ShowcaseSource> = {}) {
	return toShowcaseStore({ ...base, ...overrides });
}

describe('showcase stores', () => {
	it('maps price, category, creator and the tall image', () => {
		expect(store()).toEqual({
			id: 'north-ridge',
			title: 'North Ridge Coffee Store',
			wordmark: 'North Ridge Coffee',
			category: 'store',
			categoryLabel: 'Store',
			priceLabel: '$29',
			isFree: false,
			priceCents: 2900,
			userName: 'Estori Team',
			byline: 'by Estori Team',
			imageUrl: '/api/screenshots/north-ridge/showcase.jpg?token=a',
			tallImage: true,
		});
	});

	it('falls back to the desktop screenshot, and leaves out a missing creator, category and price', () => {
		const item = store({ showcaseScreenshotUrl: null, userName: null, category: null, priceCents: null });
		expect(item.imageUrl).toBe('/api/screenshots/north-ridge/latest.png?token=a');
		expect(item.tallImage).toBe(false);
		expect(item.byline).toBeNull();
		expect(item.categoryLabel).toBeNull();
		expect(item.priceLabel).toBe('Free');
		expect(item.isFree).toBe(true);
	});

	it('leaves stores without any screenshot out of the showcase', () => {
		const stores = [store(), store({ id: 'x', screenshotUrl: null, showcaseScreenshotUrl: null })];
		expect(storesWithImages(stores).map((s) => s.id)).toEqual(['north-ridge']);
	});

	it('hides the sections at two stores or fewer', () => {
		expect(shouldShowShowcase(0)).toBe(false);
		expect(shouldShowShowcase(2)).toBe(false);
		expect(shouldShowShowcase(3)).toBe(true);
	});

	it("offers All plus the categories present, in Discover's order, and no filters for a single category", () => {
		const mixed = [store({ id: 'a', category: 'landing' }), store({ id: 'b' }), store({ id: 'c' })];
		expect(showcaseFilters(mixed)).toEqual(['all', 'store', 'landing']);
		expect(showcaseFilters([store({ id: 'a' }), store({ id: 'b' })])).toEqual([]);
		expect(showcaseFilterLabel('all')).toBe('All');
		expect(showcaseFilterLabel('landing')).toBe('Landing page');
	});

	it('filters by category', () => {
		const mixed = [store({ id: 'a', category: 'landing' }), store({ id: 'b' })];
		expect(filterShowcase(mixed, 'landing').map((s) => s.id)).toEqual(['a']);
		expect(filterShowcase(mixed, 'all').map((s) => s.id)).toEqual(['a', 'b']);
	});

	it('shows fewer than 12 showcased stores as one still row, and 12 or more as two moving rows in opposite order', () => {
		const ids = (count: number) => Array.from({ length: count }, (_, index) => `s${index}`);
		const eleven = ids(11).map((id) => store({ id }));
		expect(SHOWCASE_MOVING_MIN).toBe(12);
		expect(showcaseLayout(eleven)).toEqual({ kind: 'static', row: eleven });
		const twelve = ids(12).map((id) => store({ id }));
		const layout = showcaseLayout(twelve);
		expect(layout.kind).toBe('marquee');
		if (layout.kind === 'marquee') {
			expect(layout.rows[0].map((s) => s.id)).toEqual(ids(12));
			expect(layout.rows[1].map((s) => s.id)).toEqual(ids(12).reverse());
		}
	});
});
