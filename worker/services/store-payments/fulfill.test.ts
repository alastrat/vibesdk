import { describe, expect, it } from 'vitest';
import type { StripeCheckoutSession } from '../payments/stripe-client';
import type { PaidCatalogCheckout } from '../catalog/record';
import { recordStoreOrder, type RecordStoreOrderDeps } from './fulfill';
import type { NewStoreOrder, StoreCheckoutRecord } from './store';

const CHECKOUT: StoreCheckoutRecord = {
	id: 'chk_ab12',
	mode: 'test',
	appId: 'app_1',
	storeVersionId: null,
	commitHash: 'c0ffee',
	sellerUserId: 'u1',
	sellerStripeAccountId: 'acct_1',
	shipToCountry: 'US',
	pricedCart: {
		mode: 'test',
		storeAppId: 'app_1',
		storeVersionId: null,
		commitHash: 'c0ffee',
		sellerStripeAccountId: 'acct_1',
		currency: 'usd',
		shipToCountry: 'US',
		lines: [
			{ kind: 'own', productId: 'trail-mug', variantId: 'trail-mug-blue', name: 'Trail Mug, Blue', quantity: 1, unitPriceCents: 2000 },
			{
				kind: 'catalog',
				productId: 'desk-lamp',
				variantId: 'desk-lamp-black',
				name: 'Desk Lamp, Black',
				quantity: 1,
				unitPriceCents: 3500,
				catalogVariantId: 'cv_lamp',
				supplier: 'cjdropshipping',
				supplierVariantId: 'cj_vid_lamp',
				destinationCountry: 'US',
				lockedCatalogPriceCents: 1200,
			},
		],
		subtotalCents: 5500,
		shippingCents: 600,
		totalCents: 6100,
	},
	subtotalCents: 5500,
	shippingCents: 600,
	totalCents: 6100,
	applicationFeeCents: 1407,
	status: 'open',
	successPath: '/thanks',
	cancelPath: '/cart',
	note: null,
	weightedCents: 0,
	createdAt: new Date(0),
	expiresAt: new Date(0),
};

const PAID: StripeCheckoutSession = {
	id: 'cs_1',
	url: null,
	payment_status: 'paid',
	status: 'complete',
	client_reference_id: 'chk_ab12',
	metadata: { kind: 'store_order', checkoutId: 'chk_ab12', storeAppId: 'app_1' },
	amount_total: 6100,
	currency: 'usd',
	payment_intent: 'pi_1',
	customer_details: { email: 'ada@example.com', name: 'Ada Lovelace', phone: '+15125550100' },
	collected_information: {
		shipping_details: { name: 'Ada Lovelace', address: { line1: '1 Main St', line2: null, city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' } },
	},
};

function fakeDeps(recordAs: 'recorded' | 'already-recorded' = 'recorded') {
	const orders: NewStoreOrder[] = [];
	const handedOff: PaidCatalogCheckout[] = [];
	const settled: string[] = [];
	const notified: string[] = [];
	const deps: RecordStoreOrderDeps = {
		getCheckout: async (id) => (id === CHECKOUT.id ? CHECKOUT : null),
		recordOrder: async (order) => {
			orders.push(order);
			return recordAs;
		},
		handOffCatalogLines: async (paid) => {
			handedOff.push(paid);
		},
		settleSale: async (orderId) => {
			settled.push(orderId);
		},
		notifyNewOrder: async (orderId) => {
			notified.push(orderId);
		},
		now: () => new Date(5),
	};
	return { deps, orders, handedOff, settled, notified };
}

describe('recordStoreOrder', () => {
	it('tells the seller about the order once, when it is first recorded', async () => {
		const first = fakeDeps('recorded');
		await recordStoreOrder(first.deps, PAID);
		expect(first.notified).toEqual(['ord_ab12']);
		const again = fakeDeps('already-recorded');
		await recordStoreOrder(again.deps, PAID);
		expect(again.notified).toEqual([]);
	});

	it("records a paid session from the checkout's prices and the shopper's details, and hands over catalog lines", async () => {
		const { deps, orders, handedOff } = fakeDeps();
		const result = await recordStoreOrder(deps, PAID);

		expect(result).toEqual({ result: 'recorded', orderId: 'ord_ab12', checkout: CHECKOUT });
		expect(orders[0]).toMatchObject({
			id: 'ord_ab12',
			checkoutId: 'chk_ab12',
			stripeCheckoutSessionId: 'cs_1',
			stripePaymentIntentId: 'pi_1',
			totalCents: 6100,
			applicationFeeCents: 1407,
			customerEmail: 'ada@example.com',
			customerName: 'Ada Lovelace',
			needsAttention: null,
		});
		expect(orders[0].items.map((item) => [item.lineNo, item.kind, item.catalogVariantId])).toEqual([
			[1, 'own', null],
			[2, 'catalog', 'cv_lamp'],
		]);
		const address = { name: 'Ada Lovelace', line1: '1 Main St', line2: null, city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US', phone: '+15125550100', email: 'ada@example.com' };
		expect(orders[0].shippingAddress).toEqual(address);
		expect(handedOff).toEqual([
			{
				checkoutSessionId: 'cs_1',
				paymentIntentId: 'pi_1',
				sellerUserId: 'u1',
				storeAppId: 'app_1',
				shippingAddress: address,
				cart: {
					shippingCents: 600,
					shipToCountry: 'US',
					lines: [
						{ kind: 'own', unitPriceCents: 2000, quantity: 1 },
						{ kind: 'catalog', unitPriceCents: 3500, quantity: 1, catalogVariantId: 'cv_lamp', supplier: 'cjdropshipping', supplierVariantId: 'cj_vid_lamp', lockedCatalogPriceCents: 1200 },
					],
				},
			},
		]);
	});

	it('records nothing for an unpaid session', async () => {
		const { deps, orders } = fakeDeps();
		expect(await recordStoreOrder(deps, { ...PAID, payment_status: 'unpaid' })).toEqual({ result: 'not-paid', checkout: CHECKOUT });
		expect(orders).toHaveLength(0);
	});

	it("leaves other sessions to their own handlers", async () => {
		const { deps, orders } = fakeDeps();
		expect(await recordStoreOrder(deps, { ...PAID, metadata: { listingId: 'l1' } })).toEqual({ result: 'not-ours' });
		expect(await recordStoreOrder(deps, { ...PAID, metadata: { kind: 'store_order', checkoutId: 'chk_other' } })).toEqual({ result: 'not-ours' });
		expect(orders).toHaveLength(0);
	});

	it('records a session that differs from its checkout, flagged for the owner, without buying from the supplier', async () => {
		const { deps, orders, handedOff } = fakeDeps();
		await recordStoreOrder(deps, { ...PAID, amount_total: 5000 });
		expect(orders[0].needsAttention).toBe('paid 5000 cents, expected 6100');
		expect(handedOff).toHaveLength(0);
	});

	it('hands catalog lines over again on a repeated delivery, since the hand-off is idempotent', async () => {
		const { deps, handedOff } = fakeDeps('already-recorded');
		expect((await recordStoreOrder(deps, PAID)).result).toBe('already-recorded');
		expect(handedOff).toHaveLength(1);
	});

	it('settles the sale after recording it, and again on a repeated delivery', async () => {
		const first = fakeDeps();
		await recordStoreOrder(first.deps, PAID);
		expect(first.settled).toEqual(['ord_ab12']);

		const again = fakeDeps('already-recorded');
		await recordStoreOrder(again.deps, PAID);
		expect(again.settled).toEqual(['ord_ab12']);
	});

	it('fails the delivery when settling fails, so Stripe delivers it again, and keeps the recorded order', async () => {
		const { deps, orders } = fakeDeps();
		deps.settleSale = async () => {
			throw new Error('Stripe is unavailable');
		};
		await expect(recordStoreOrder(deps, PAID)).rejects.toThrow('Stripe is unavailable');
		expect(orders).toHaveLength(1);
	});

	it('reads the address where earlier Stripe API versions put it', async () => {
		const { deps, orders } = fakeDeps();
		const details = PAID.collected_information?.shipping_details ?? null;
		await recordStoreOrder(deps, { ...PAID, collected_information: null, shipping_details: details });
		expect(orders[0].shippingAddress?.postalCode).toBe('78701');
	});
});
