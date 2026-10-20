import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isFlagOn, lockCatalogPrices } = vi.hoisted(() => ({ isFlagOn: vi.fn(), lockCatalogPrices: vi.fn() }));
vi.mock('../posthog/flags', () => ({ isFlagOn }));
vi.mock('../catalog/offers', () => ({ lockCatalogPrices }));

const { lockCatalogPricesFor } = await import('./catalog-locks');
const env = {} as Env;

describe('catalog prices at checkout', () => {
	beforeEach(() => {
		isFlagOn.mockReset();
		lockCatalogPrices.mockReset();
	});

	it("locks the catalog's prices while the catalog isn't paused, asking for the store's seller", async () => {
		isFlagOn.mockResolvedValue(false);
		lockCatalogPrices.mockResolvedValue([{ ok: true, catalogVariantId: 'cv_1', supplier: 'cjdropshipping', supplierVariantId: 'cj_1', lockedCatalogPriceCents: 1200 }]);
		expect(await lockCatalogPricesFor(env, ['cv_1'], 'US', 'seller_1')).toHaveLength(1);
		expect(isFlagOn).toHaveBeenCalledWith(env, 'catalog-paused', 'seller_1');
	});

	it('reads every catalog item as sold out while the catalog is paused, locking nothing', async () => {
		isFlagOn.mockResolvedValue(true);
		expect(await lockCatalogPricesFor(env, ['cv_1', 'cv_2'], 'US', 'seller_1')).toEqual([
			{ ok: false, catalogVariantId: 'cv_1', reason: 'unavailable' },
			{ ok: false, catalogVariantId: 'cv_2', reason: 'unavailable' },
		]);
		expect(lockCatalogPrices).not.toHaveBeenCalled();
	});
});
