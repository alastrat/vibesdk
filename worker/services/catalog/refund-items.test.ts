import { describe, expect, it } from 'vitest';
import { refundCatalogItems } from './refund-items';
import { memoryCatalogStore } from './test-support';
import type { StripeClient } from '../payments/stripe-client';

const ADDRESS = { name: 'Ada', line1: '1 Main St', line2: null, city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US', phone: null, email: null };

async function storeWithOrder() {
	const store = memoryCatalogStore();
	await store.insertPaidOrder({
		id: 'co_1',
		sellerUserId: 'u1',
		storeAppId: 'app_1',
		checkoutSessionId: 'cs_1',
		paymentIntentId: 'pi_1',
		totalCents: 9000,
		catalogTotalCents: 3600,
		applicationFeeCents: 3891,
		destinationCountry: 'US',
		shippingAddress: ADDRESS,
		items: [
			{ id: 'ci_mug', catalogVariantId: 'cv_mug', supplier: 'cjdropshipping', supplierVariantId: 'cj_mug', quantity: 2, unitPriceCents: 2500, catalogPriceCents: 1200 },
			{ id: 'ci_cap', catalogVariantId: 'cv_cap', supplier: 'cjdropshipping', supplierVariantId: 'cj_cap', quantity: 1, unitPriceCents: 4000, catalogPriceCents: 1200 },
		],
		createdAt: new Date(0),
	});
	return store;
}

function fakeStripe(transfer: string | null = 'tr_1') {
	const refunds: Array<{ amountCents: number; idempotencyKey: string }> = [];
	const reversals: Array<{ amountCents: number; idempotencyKey: string }> = [];
	const stripe: Pick<StripeClient, 'retrievePaymentIntent' | 'createRefund' | 'createTransferReversal'> = {
		retrievePaymentIntent: async (id) => ({ id, latest_charge: { id: 'ch_1', transfer } }),
		createRefund: async (input) => {
			refunds.push({ amountCents: input.amountCents, idempotencyKey: input.idempotencyKey });
			return { id: 're_1', amount: input.amountCents, status: 'succeeded' };
		},
		createTransferReversal: async (input) => {
			reversals.push({ amountCents: input.amountCents, idempotencyKey: input.idempotencyKey });
			return { id: 'trr_1', amount: input.amountCents };
		},
	};
	return { stripe, refunds, reversals };
}

describe('refundCatalogItems', () => {
	it('refunds rejected items in full, taking back only the seller share', async () => {
		const store = await storeWithOrder();
		const { stripe, refunds, reversals } = fakeStripe();

		const totals = await refundCatalogItems({ store, stripe }, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' });
		expect(totals).toEqual({ refundedItemIds: ['ci_cap'], shopperCents: 4000, sellerCents: 2800, estoriCents: 1200 });
		expect(refunds).toEqual([{ amountCents: 4000, idempotencyKey: 'catalog-refund-co_1-ci_cap' }]);
		expect(reversals).toEqual([{ amountCents: 2800, idempotencyKey: 'catalog-reversal-co_1-ci_cap' }]);
		expect(store.orders.get('co_1')?.items.find((item) => item.id === 'ci_cap')?.status).toBe('refunded');
	});

	it('charges the whole refund to the seller when the supplier kept the money', async () => {
		const store = await storeWithOrder();
		const { stripe, reversals } = fakeStripe();

		const totals = await refundCatalogItems({ store, stripe }, { orderId: 'co_1', itemIds: ['ci_mug'], reason: 'seller-refund' });
		expect(totals).toMatchObject({ shopperCents: 5000, sellerCents: 5000, estoriCents: 0 });
		expect(reversals[0].amountCents).toBe(5000);
	});

	it('skips items already refunded, so a retry refunds nobody twice', async () => {
		const store = await storeWithOrder();
		const { stripe, refunds } = fakeStripe();

		await refundCatalogItems({ store, stripe }, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' });
		const again = await refundCatalogItems({ store, stripe }, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' });
		expect(again).toEqual({ refundedItemIds: [], shopperCents: 0, sellerCents: 0, estoriCents: 0 });
		expect(refunds).toHaveLength(1);
	});

	it('makes the same idempotency keys whatever order the items are listed in', async () => {
		const first = fakeStripe();
		await refundCatalogItems({ store: await storeWithOrder(), stripe: first.stripe }, { orderId: 'co_1', itemIds: ['ci_mug', 'ci_cap'], reason: 'seller-refund' });
		const second = fakeStripe();
		await refundCatalogItems({ store: await storeWithOrder(), stripe: second.stripe }, { orderId: 'co_1', itemIds: ['ci_cap', 'ci_mug'], reason: 'seller-refund' });
		expect(second.refunds[0].idempotencyKey).toBe(first.refunds[0].idempotencyKey);
	});

	it('refuses a payment with no transfer to reverse, before refunding anything', async () => {
		const store = await storeWithOrder();
		const { stripe, refunds } = fakeStripe(null);

		await expect(refundCatalogItems({ store, stripe }, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' })).rejects.toThrow(
			'The payment has no transfer to the seller',
		);
		expect(refunds).toHaveLength(0);
	});
});
