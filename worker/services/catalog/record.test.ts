import { describe, expect, it } from 'vitest';
import { recordPaidCatalogOrder, type PaidCatalogCheckout } from './record';
import { memoryCatalogStore } from './test-support';

const ADDRESS = { name: 'Ada', line1: '1 Main St', line2: null, city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US', phone: null, email: null };

const PAID: PaidCatalogCheckout = {
	checkoutSessionId: 'cs_1',
	paymentIntentId: 'pi_1',
	sellerUserId: 'u1',
	storeAppId: 'app_1',
	shippingAddress: ADDRESS,
	cart: {
		shipToCountry: 'US',
		shippingCents: 500,
		lines: [
			{ kind: 'catalog', catalogVariantId: 'cv_mug', supplier: 'cjdropshipping', supplierVariantId: 'cj_mug', lockedCatalogPriceCents: 1200, unitPriceCents: 2500, quantity: 2 },
			{ kind: 'own', unitPriceCents: 1500, quantity: 1 },
		],
	},
};

function deps(store = memoryCatalogStore()) {
	let next = 0;
	return { store, newId: () => `id_${(next += 1)}`, now: () => new Date(1_800_000_000_000) };
}

describe('recordPaidCatalogOrder', () => {
	it('records the catalog lines of a paid checkout, with the fee and the locked prices', async () => {
		const store = memoryCatalogStore();
		const outcome = await recordPaidCatalogOrder(deps(store), PAID);

		expect(outcome).toEqual({ result: 'recorded', orderId: 'id_1' });
		const order = store.orders.get('id_1');
		expect(order?.items).toEqual([
			expect.objectContaining({ id: 'id_2', supplierVariantId: 'cj_mug', quantity: 2, catalogPriceCents: 1200, unitPriceCents: 2500, status: 'pending' }),
		]);
	});

	it('records a redelivered session only once', async () => {
		const store = memoryCatalogStore();
		await recordPaidCatalogOrder(deps(store), PAID);
		const again = await recordPaidCatalogOrder(deps(store), PAID);

		expect(again).toEqual({ result: 'already-recorded', orderId: null });
		expect(store.orders.size).toBe(1);
	});

	it('records nothing for a cart without catalog items', async () => {
		const store = memoryCatalogStore();
		const ownOnly = { ...PAID, cart: { ...PAID.cart, lines: [{ kind: 'own', unitPriceCents: 1500, quantity: 1 }] as const } };

		expect(await recordPaidCatalogOrder(deps(store), ownOnly)).toEqual({ result: 'no-catalog-items', orderId: null });
		expect(store.orders.size).toBe(0);
	});
});
