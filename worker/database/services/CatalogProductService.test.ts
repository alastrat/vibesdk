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

	it('keeps every statement under 100 parameters for a long curated list, and retires products that left it', async () => {
		const { d1, batches } = recordingD1((sql) => (sql.toLowerCase().startsWith('select') ? [['cp_old', 'p_old']] : []));
		const entries = Array.from({ length: 120 }, (_, index) => ({ supplierProductId: `p_${index}`, category: 'Home' }));
		await new CatalogProductService({ DB: d1 } as unknown as Env).ensureCurated(entries, new Date(1_800_000_000_000));

		expect(Math.max(...batches[0].map((entry) => entry.params.length))).toBeLessThanOrEqual(100);
		const retire = batches[0].find((entry) => entry.sql.toLowerCase().startsWith('update "catalog_products"'));
		expect(retire?.params).toContain('cp_old');
	});

	it('never overwrites a curated category, or a title the list leaves out', async () => {
		const { d1, batches } = recordingD1();
		const service = new CatalogProductService({ DB: d1 } as unknown as Env);
		await service.ensureCurated([{ supplierProductId: 'p1', category: 'Home' }], new Date(1_800_000_000_000));
		const upsert = batches[0].find((entry) => entry.sql.toLowerCase().startsWith('insert into "catalog_products"'));
		expect(upsert?.sql.toLowerCase().split('do update set')[1]).not.toContain('"title"');

		await service.saveRefresh(REFRESHED);
		const update = batches[1].find((entry) => entry.sql.toLowerCase().startsWith('update "catalog_products"'));
		expect(update?.sql.toLowerCase()).not.toContain('"category"');
	});

	it('sells only active variants of active products', async () => {
		const updatedAt = Math.floor(1_800_000_000_000 / 1000);
		const { d1 } = recordingD1([
			['cv_1', 'v1', 1, 2028, updatedAt, 'paused', 'active'],
			['cv_2', 'v2', 1, 2028, updatedAt, 'active', 'retired'],
			['cv_3', 'v3', 1, 2028, updatedAt, 'active', 'active'],
		]);
		const lookups = await new CatalogProductService({ DB: d1 } as unknown as Env).lookupOffers(['cv_1', 'cv_2', 'cv_3'], 'US');
		expect(lookups.map((lookup) => lookup.offer?.available)).toEqual([false, false, true]);
	});

	it('pushes a failing product back in the queue, and stops selling one the supplier removed', async () => {
		const { d1, batches } = recordingD1();
		await new CatalogProductService({ DB: d1 } as unknown as Env).recordRefreshError('cp_1', 'Product removed', new Date(1_800_000_000_000), true);
		const statements = batches[0].map((entry) => entry.sql.toLowerCase());
		expect(statements[0]).toContain('"details_refreshed_at" = ?');
		expect(statements[1]).toContain('update "catalog_variant_offers"');
	});
});
