import { describe, expect, it } from 'vitest';
import { catalogText } from './catalog-text';
import { chooseFreight, refreshCatalogBatch, type RefreshDeps } from './refresh';
import type { CatalogRefreshStore, ClaimedProduct, RefreshedProduct } from './catalog-store';
import type { CjFreightOption, CjProduct } from './cj/types';
import { CjApiError } from './cj/errors';

const NOW = 1_800_000_000_000;

const PRODUCT: CjProduct = {
	pid: 'p1',
	productNameEn: 'Gravity Pet Feeder Water Dispenser',
	productSku: 'CJFT1',
	status: '3',
	categoryName: 'Pet Supplies / Feeding',
	productKeyEn: 'Color',
	productImageSet: ['https://cf.example/a.jpg', 'https://cf.example/b.jpg'],
	productImage: null,
	description: '<p><b>Overview:</b></p><p>Feeds and waters.</p><p>Ships from CJdropshipping.</p>',
	materialNameEn: ['Plastic'],
	variants: [
		{ vid: 'v-blue', variantSku: 'S1', variantNameEn: '', variantKey: 'Blue', variantImage: 'https://cf.example/blue.jpg', variantWeight: 200, variantSellPrice: 16.9 },
		{ vid: 'v-pink', variantSku: 'S2', variantNameEn: 'Pink', variantKey: 'Pink', variantImage: null, variantWeight: '200', variantSellPrice: '16.90' },
	],
};

function fakeStore(claimed: ClaimedProduct[]) {
	const saved: RefreshedProduct[] = [];
	const errors: Array<{ productId: string; message: string; retire: boolean }> = [];
	const store: CatalogRefreshStore = {
		ensureCurated: async () => {},
		claimForRefresh: async () => claimed,
		saveRefresh: async (product) => {
			saved.push(product);
		},
		recordRefreshError: async (productId, message, _now, retire) => {
			errors.push({ productId, message, retire });
		},
	};
	return { store, saved, errors };
}

function deps(store: CatalogRefreshStore, overrides: Partial<RefreshDeps['client']> = {}): RefreshDeps {
	return {
		store,
		now: () => NOW,
		images: { copy: async (productId, url) => `catalog/${productId}/${url.split('/').pop()}` },
		client: {
			queryProduct: async () => PRODUCT,
			inventoryByPid: async () => ({ variantInventories: [{ vid: 'v-blue', inventory: [{ countryCode: 'US', totalInventory: 262 }] }, { vid: 'v-pink', inventory: [{ countryCode: 'US', totalInventory: 4 }] }] }),
			freightCalculate: async () => [{ logisticName: 'USPS US to US', logisticAging: '3-5', totalPostageFee: 0, logisticPrice: 0 }],
			pointsRemaining: () => 40_000,
			...overrides,
		},
	};
}

const CLAIMED: ClaimedProduct = { id: 'cp_1', supplierProductId: 'p1', status: 'active', title: null, imageKeys: [] };

describe('refreshCatalogBatch', () => {
	it('prices every variant for each destination, and holds back stock under the buffer', async () => {
		const { store, saved } = fakeStore([CLAIMED]);
		expect(await refreshCatalogBatch(deps(store))).toEqual({ refreshed: 1, failed: 0, stoppedForPoints: false });

		const product = saved[0];
		expect(product).toMatchObject({ productId: 'cp_1', title: 'Gravity Pet Feeder Water Dispenser', category: 'Pet Supplies / Feeding', attributes: { Material: 'Plastic' } });
		expect(product.imageKeys).toEqual(['catalog/cp_1/a.jpg', 'catalog/cp_1/b.jpg']);
		expect(product.variants.map((variant) => [variant.supplierVariantId, variant.name, variant.options, variant.supplierCostCents, variant.stock, variant.imageKey])).toEqual([
			['v-blue', 'Blue', { Color: 'Blue' }, 1690, { US: 262 }, 'catalog/cp_1/blue.jpg'],
			['v-pink', 'Pink', { Color: 'Pink' }, 1690, { US: 4 }, null],
		]);
		expect(product.offers).toEqual([
			{ supplierVariantId: 'v-blue', destinationCountry: 'US', originCountry: 'US', logisticName: 'USPS US to US', deliveryDaysMin: 3, deliveryDaysMax: 5, supplierCostCents: 1690, shippingCents: 0, catalogPriceCents: 2028, available: true, unavailableReason: null },
			{ supplierVariantId: 'v-pink', destinationCountry: 'US', originCountry: 'US', logisticName: 'USPS US to US', deliveryDaysMin: 3, deliveryDaysMax: 5, supplierCostCents: 1690, shippingCents: 0, catalogPriceCents: 2028, available: false, unavailableReason: 'out-of-stock' },
		]);
		expect(product.description).toBe('Overview: Feeds and waters.');
	});

	it('marks offers unavailable when no shipping option delivers in time, or the product is paused or off sale', async () => {
		const slow = fakeStore([CLAIMED]);
		await refreshCatalogBatch(deps(slow.store, { freightCalculate: async () => [{ logisticName: 'Slow Post', logisticAging: '12-20', totalPostageFee: 2, logisticPrice: 2 }] }));
		expect(slow.saved[0].offers.map((offer) => [offer.available, offer.unavailableReason, offer.catalogPriceCents])).toEqual([
			[false, 'no-shipping', null],
			[false, 'no-shipping', null],
		]);

		const paused = fakeStore([{ ...CLAIMED, status: 'paused' }]);
		await refreshCatalogBatch(deps(paused.store));
		expect(paused.saved[0].offers.every((offer) => !offer.available && offer.unavailableReason === 'paused')).toBe(true);

		const offSale = fakeStore([CLAIMED]);
		await refreshCatalogBatch(deps(offSale.store, { queryProduct: async () => ({ ...PRODUCT, status: '2' }) }));
		expect(offSale.saved[0].variants.every((variant) => variant.status === 'retired')).toBe(true);
		expect(offSale.saved[0].offers.every((offer) => offer.unavailableReason === 'retired')).toBe(true);
	});

	it('records a failing product and carries on with the rest', async () => {
		const { store, saved, errors } = fakeStore([CLAIMED, { ...CLAIMED, id: 'cp_2', supplierProductId: 'p2' }]);
		const result = await refreshCatalogBatch(
			deps(store, {
				queryProduct: async (pid) => {
					if (pid === 'p1') throw new Error('Product removed');
					return { ...PRODUCT, pid };
				},
			}),
		);
		expect(result).toEqual({ refreshed: 1, failed: 1, stoppedForPoints: false });
		expect(errors).toEqual([{ productId: 'cp_1', message: 'Product removed', retire: false }]);
		expect(saved.map((product) => product.productId)).toEqual(['cp_2']);
	});

	it('stops selling a product the supplier says is gone', async () => {
		const { store, errors } = fakeStore([CLAIMED]);
		await refreshCatalogBatch(deps(store, { queryProduct: async () => Promise.reject(new CjApiError('Product removed', 200, 1602001, 'r1')) }));
		expect(errors).toEqual([{ productId: 'cp_1', message: 'Product removed', retire: true }]);
	});

	it('skips variants the supplier prices at nothing', async () => {
		const { store, saved } = fakeStore([CLAIMED]);
		const free = { ...PRODUCT, variants: [{ ...PRODUCT.variants[0], variantSellPrice: 0 }, PRODUCT.variants[1]] };
		await refreshCatalogBatch(deps(store, { queryProduct: async () => free }));
		expect(saved[0].variants.map((variant) => variant.supplierVariantId)).toEqual(['v-pink']);
	});

	it('stops before the points reserve', async () => {
		const { store, saved } = fakeStore([CLAIMED, { ...CLAIMED, id: 'cp_2' }]);
		const result = await refreshCatalogBatch(deps(store, { pointsRemaining: () => 4_000 }));
		expect(result).toEqual({ refreshed: 0, failed: 0, stoppedForPoints: true });
		expect(saved).toHaveLength(0);
	});
});

describe('chooseFreight', () => {
	const options: CjFreightOption[] = [
		{ logisticName: 'Fast', logisticAging: '2-3', totalPostageFee: '6.50', logisticPrice: '6.50' },
		{ logisticName: 'Cheap', logisticAging: '5-9', totalPostageFee: '3.10', logisticPrice: '3.10' },
		{ logisticName: 'Cheap but slow', logisticAging: '15-25', totalPostageFee: '1.00', logisticPrice: '1.00' },
		{ logisticName: 'Cheap too', logisticAging: '4-7', totalPostageFee: '3.10', logisticPrice: '3.10' },
	];

	it('never reads a shipping price below what the option charges', () => {
		expect(chooseFreight([{ logisticName: 'Odd', logisticAging: '3-5', totalPostageFee: 0, logisticPrice: '4.50' }], 10)?.shippingCents).toBe(450);
	});

	it('takes the cheapest option that arrives in time, then the quicker one', () => {
		expect(chooseFreight(options, 10)).toEqual({ logisticName: 'Cheap too', shippingCents: 310, daysMin: 4, daysMax: 7 });
		expect(chooseFreight(options, 3)).toEqual({ logisticName: 'Fast', shippingCents: 650, daysMin: 2, daysMax: 3 });
		expect(chooseFreight(options, 1)).toBeNull();
	});
});

describe('catalogText', () => {
	it('keeps plain text and drops lines naming a supplier', () => {
		expect(catalogText('<p>Soft&nbsp;cotton &amp; wool.</p><br/><p>Sold on AliExpress too.</p>')).toBe('Soft cotton & wool.');
		expect(catalogText(null)).toBe('');
		expect(catalogText(`<p>${'a'.repeat(6000)}</p>`)).toHaveLength(5000);
	});
});
