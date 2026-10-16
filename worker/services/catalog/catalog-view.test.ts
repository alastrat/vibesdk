import { describe, expect, it } from 'vitest';
import { suggestedRetailPriceCents } from '../../../shared/types/catalog';
import { agentProductView, catalogProductView, type CatalogRows } from './catalog-view';

const NOW = 1_800_000_000_000;
const ROWS: CatalogRows = {
	product: { id: 'cp_1', title: 'Gravity Pet Feeder', description: 'Feeds and waters.', category: 'Pet supplies', images: ['catalog/cp_1/a.jpg'], status: 'active' },
	variants: [
		{ id: 'cv_blue', name: 'Blue', options: { Color: 'Blue' }, imageKey: 'catalog/cp_1/b.jpg', status: 'active' },
		{ id: 'cv_pink', name: 'Pink', options: { Color: 'Pink' }, imageKey: null, status: 'active' },
		{ id: 'cv_old', name: 'Old', options: {}, imageKey: null, status: 'retired' },
	],
	offers: [
		{ variantId: 'cv_blue', destinationCountry: 'US', available: true, catalogPriceCents: 2028, deliveryDaysMin: 3, deliveryDaysMax: 5, updatedAt: new Date(NOW - 60_000) },
		{ variantId: 'cv_pink', destinationCountry: 'US', available: true, catalogPriceCents: 2028, deliveryDaysMin: 3, deliveryDaysMax: 5, updatedAt: new Date(NOW - 73 * 60 * 60 * 1000) },
	],
};

const url = (key: string) => `https://estori.test/api/catalog/images/${key.slice('catalog/'.length)}`;

describe('suggestedRetailPriceCents', () => {
	it('doubles the catalog price, ending in 99 cents, never below the minimum', () => {
		expect(suggestedRetailPriceCents(2028)).toBe(4099);
		expect(suggestedRetailPriceCents(985)).toBe(1999);
	});
});

describe('catalogProductView', () => {
	it('shows active variants with their cost, minimum and suggested price, and hides stale prices', () => {
		const view = catalogProductView(ROWS, url, NOW);
		expect(view).toEqual({
			productId: 'cp_1',
			title: 'Gravity Pet Feeder',
			description: 'Feeds and waters.',
			category: 'Pet supplies',
			imageUrls: ['https://estori.test/api/catalog/images/cp_1/a.jpg'],
			shipsTo: ['US'],
			variants: [
				{
					catalogVariantId: 'cv_blue',
					name: 'Blue',
					options: { Color: 'Blue' },
					imageUrl: 'https://estori.test/api/catalog/images/cp_1/b.jpg',
					available: true,
					deliveryDays: { min: 3, max: 5 },
					catalogPriceCents: 2028,
					minimumRetailPriceCents: 2119,
					suggestedRetailPriceCents: 4099,
				},
				{ catalogVariantId: 'cv_pink', name: 'Pink', options: { Color: 'Pink' }, imageUrl: null, available: false, deliveryDays: null, catalogPriceCents: null, minimumRetailPriceCents: null, suggestedRetailPriceCents: null },
			],
		});
	});

	it('shows nothing for a product that is not active', () => {
		expect(catalogProductView({ ...ROWS, product: { ...ROWS.product, status: 'paused' } }, url, NOW)).toBeNull();
	});

	it('gives the agent no catalog price to copy', () => {
		const view = catalogProductView(ROWS, url, NOW);
		if (!view) throw new Error('expected a view');
		const agent = agentProductView(view);
		expect(JSON.stringify(agent)).not.toContain('catalogPriceCents');
		expect(agent.variants[0]).toMatchObject({ catalogVariantId: 'cv_blue', minimumRetailPriceCents: 2119, suggestedRetailPriceCents: 4099 });
	});
});
