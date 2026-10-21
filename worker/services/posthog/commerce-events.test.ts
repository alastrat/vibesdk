import { describe, expect, it } from 'vitest';
import { catalogOrderPlacedProperties, saleCompletedProperties, stripeReady, templateSoldProperties } from './commerce-events';
import type { NewStoreOrder } from '../store-payments/store';
import type { PaidCatalogCheckout } from '../catalog/record';
import type { StripePurchaseRecord } from '../../database/services/TemplateService';

const ORDER = {
	appId: 'app_1',
	mode: 'live',
	totalCents: 4_250,
	applicationFeeCents: 2_249,
	items: [
		{ lineNo: 1, kind: 'own', productId: 'p1', variantId: 'v1', name: 'Mug', quantity: 1, unitPriceCents: 1_500, catalogVariantId: null, lockedCatalogPriceCents: null },
		{ lineNo: 2, kind: 'catalog', productId: 'p2', variantId: 'v2', name: 'Tee', quantity: 2, unitPriceCents: 1_375, catalogVariantId: 'cv_2', lockedCatalogPriceCents: 900 },
	],
} as unknown as NewStoreOrder;

describe('store and money events', () => {
	it("give a sale's total as a band, Estori's fee exact, and whether it is the first", () => {
		expect(saleCompletedProperties(ORDER, true)).toEqual({ app_id: 'app_1', mode: 'live', total_band: '25_to_100', application_fee_cents: 2_249, has_catalog_items: true, first_sale: true });
		expect(saleCompletedProperties({ ...ORDER, items: [ORDER.items[0]] }, false)).toMatchObject({ has_catalog_items: false, first_sale: false });
	});

	it('count the catalog units handed to the supplier flow', () => {
		const paid = { storeAppId: 'app_1', cart: { lines: [{ kind: 'own', quantity: 3 }, { kind: 'catalog', quantity: 2 }, { kind: 'catalog', quantity: 1 }] } } as unknown as PaidCatalogCheckout;
		expect(catalogOrderPlacedProperties(paid)).toEqual({ app_id: 'app_1', item_count: 3 });
	});

	it('give a template sale its public price and the platform fee', () => {
		expect(templateSoldProperties({ listingId: 'lst_1', priceCents: 4_900, platformFeeCents: 490 } as StripePurchaseRecord)).toEqual({ listing_id: 'lst_1', price_cents: 4_900, platform_fee_cents: 490 });
	});

	it("call a Stripe account ready once Stripe's side of store payments is complete", () => {
		const ready = { detailsSubmitted: true, cardPaymentsActive: true, transfersActive: true, payoutsEnabled: true };
		expect(stripeReady(ready)).toBe(true);
		for (const missing of Object.keys(ready) as Array<keyof typeof ready>) expect(stripeReady({ ...ready, [missing]: false }), missing).toBe(false);
	});
});
