import { describe, expect, it } from 'vitest';
import { CatalogProductService } from './CatalogProductService';
import { recordingD1 } from '../test-support/recording-d1';
import type { RefreshedProduct } from '../../services/catalog/catalog-store';

const REFRESHED: RefreshedProduct = {
	productId: 'cp_1',
	title: 'Gravity Pet Feeder',
	description: 'A feeder.',
	category: 'Pet Supplies',
	imageKeys: ['catalog/cp_1/a.jpg'],
	attributes: { Material: 'Plastic' },
	variants: [
		{ supplierVariantId: 'v1', sku: 'S1', name: 'Blue', options: { Color: 'Blue' }, imageKey: null, weightGrams: 200, supplierCostCents: 1690, stock: { US: 262 }, status: 'active' },
		{ supplierVariantId: 'v2', sku: 'S2', name: 'Pink', options: { Color: 'Pink' }, imageKey: null, weightGrams: 200, supplierCostCents: 1690, stock: { US: 258 }, status: 'active' },
	],
	offers: [
		{ supplierVariantId: 'v1', destinationCountry: 'US', originCountry: 'US', logisticName: 'USPS', deliveryDaysMin: 3, deliveryDaysMax: 5, supplierCostCents: 1690, shippingCents: 0, catalogPriceCents: 2028, available: true, unavailableReason: null },
		{ supplierVariantId: 'v2', destinationCountry: 'US', originCountry: 'US', logisticName: 'USPS', deliveryDaysMin: 3, deliveryDaysMax: 5, supplierCostCents: 1690, shippingCents: 0, catalogPriceCents: 2028, available: true, unavailableReason: null },
	],
	refreshedAt: new Date(1_800_000_000_000),
};

describe('CatalogProductService', () => {
	it("writes a product's refresh in one batch, one statement per row", async () => {
		const { d1, batches } = recordingD1();
		await new CatalogProductService({ DB: d1 } as unknown as Env).saveRefresh(REFRESHED);

		expect(batches).toHaveLength(1);
		const kinds = batches[0].map((entry) => entry.sql.split(' ').slice(0, 3).join(' ').toLowerCase());
		expect(kinds.filter((kind) => kind === 'insert into "catalog_variants"')).toHaveLength(2);
		expect(kinds.filter((kind) => kind === 'insert into "catalog_variant_offers"')).toHaveLength(2);
		expect(kinds[0]).toBe('update "catalog_products" set');
		expect(Math.max(...batches[0].map((entry) => entry.params.length))).toBeLessThanOrEqual(100);
	});

	it('claims the stalest active products with one update that returns them', async () => {
		const { d1, statements } = recordingD1((sql) => (sql.toLowerCase().includes('returning') ? [['cp_1', 'p1', 'active', null, '[]']] : []));
		const claimed = await new CatalogProductService({ DB: d1 } as unknown as Env).claimForRefresh(15, new Date(1_800_000_000_000));

		expect(claimed).toEqual([{ id: 'cp_1', supplierProductId: 'p1', status: 'active', title: null, imageKeys: [] }]);
		const claim = statements.find((statement) => statement.sql.toLowerCase().startsWith('update "catalog_products"'));
		expect(claim?.sql.toLowerCase()).toContain('returning');
	});
});
