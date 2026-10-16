import { describe, expect, it } from 'vitest';
import { RefundExceedsTransferError, refundCatalogItems } from './refund-items';
import { memoryCatalogStore } from './test-support';
import type { StripeClient } from '../payments/stripe-client';

const ADDRESS = { name: 'Ada', line1: '1 Main St', line2: null, city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US', phone: null, email: null };

/** A $90 payment with a $38.91 application fee: Stripe transferred $51.09 to the seller. */
const TRANSFERRED_CENTS = 9000 - 3891;

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

/** Stripe as it behaves here: one refund or reversal per key, and no reversal beyond what is left of the transfer. */
function fakeStripe(options: { transfer?: boolean; failReversals?: number } = {}) {
	const refunds: Array<{ amountCents: number; idempotencyKey: string }> = [];
	const reversals: Array<{ amountCents: number; idempotencyKey: string }> = [];
	let reversed = 0;
	let failuresLeft = options.failReversals ?? 0;
	const stripe: Pick<StripeClient, 'retrievePaymentIntent' | 'createRefund' | 'createTransferReversal'> = {
		retrievePaymentIntent: async (id) => ({
			id,
			latest_charge: { id: 'ch_1', transfer: options.transfer === false ? null : { id: 'tr_1', amount: TRANSFERRED_CENTS, amount_reversed: reversed } },
		}),
		createRefund: async (input) => {
			if (!refunds.some((refund) => refund.idempotencyKey === input.idempotencyKey)) refunds.push({ amountCents: input.amountCents, idempotencyKey: input.idempotencyKey });
			return { id: `re_${refunds.length}`, amount: input.amountCents, status: 'succeeded' };
		},
		createTransferReversal: async (input) => {
			if (failuresLeft > 0) {
				failuresLeft -= 1;
				throw new Error('Stripe is unavailable');
			}
			if (input.idempotencyKey.length > 255) throw new Error('Idempotency key too long');
			if (reversed + input.amountCents > TRANSFERRED_CENTS) throw new Error('Insufficient funds in the transfer to reverse');
			reversed += input.amountCents;
			reversals.push({ amountCents: input.amountCents, idempotencyKey: input.idempotencyKey });
			return { id: `trr_${reversals.length}`, amount: input.amountCents };
		},
	};
	return { stripe, refunds, reversals };
}

function itemOf(store: Awaited<ReturnType<typeof storeWithOrder>>, itemId: string) {
	return store.orders.get('co_1')?.items.find((item) => item.id === itemId);
}

describe('refundCatalogItems', () => {
	it('refunds rejected items in full, taking back only the seller share', async () => {
		const store = await storeWithOrder();
		const { stripe, refunds, reversals } = fakeStripe();

		const totals = await refundCatalogItems({ store, stripe }, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' });
		expect(totals).toEqual({ refundedItemIds: ['ci_cap'], shopperCents: 4000, sellerCents: 2800, estoriCents: 1200 });
		expect(refunds).toEqual([{ amountCents: 4000, idempotencyKey: 'catalog-refund-ci_cap' }]);
		expect(reversals).toEqual([{ amountCents: 2800, idempotencyKey: 'catalog-reversal-ci_cap' }]);
		expect(itemOf(store, 'ci_cap')).toMatchObject({ status: 'refunded', sellerReversalDueCents: 0 });
	});

	it('charges the whole refund to the seller when the supplier kept the money', async () => {
		const store = await storeWithOrder();
		const { stripe, reversals } = fakeStripe();

		const totals = await refundCatalogItems({ store, stripe }, { orderId: 'co_1', itemIds: ['ci_mug'], reason: 'seller-refund' });
		expect(totals).toMatchObject({ shopperCents: 5000, sellerCents: 5000, estoriCents: 0 });
		expect(reversals[0].amountCents).toBe(5000);
	});

	it("takes back no more than is left of the seller's transfer when every item is rejected; Estori pays the rest", async () => {
		const store = await storeWithOrder();
		const { stripe, refunds, reversals } = fakeStripe();

		const totals = await refundCatalogItems({ store, stripe }, { orderId: 'co_1', itemIds: ['ci_mug', 'ci_cap'], reason: 'supplier-rejected' });
		expect(refunds.map((refund) => refund.amountCents)).toEqual([4000, 5000]);
		expect(reversals.map((reversal) => reversal.amountCents)).toEqual([2800, TRANSFERRED_CENTS - 2800]);
		expect(totals).toEqual({ refundedItemIds: ['ci_cap', 'ci_mug'], shopperCents: 9000, sellerCents: TRANSFERRED_CENTS, estoriCents: 9000 - TRANSFERRED_CENTS });
	});

	it('refuses a seller refund larger than what the seller received, before any money moves', async () => {
		const store = await storeWithOrder();
		const { stripe, refunds, reversals } = fakeStripe();

		await expect(refundCatalogItems({ store, stripe }, { orderId: 'co_1', itemIds: ['ci_mug', 'ci_cap'], reason: 'seller-refund' })).rejects.toBeInstanceOf(
			RefundExceedsTransferError,
		);
		expect(refunds).toHaveLength(0);
		expect(reversals).toHaveLength(0);
		expect(itemOf(store, 'ci_mug')?.status).toBe('pending');
	});

	it('skips items already refunded, so a retry refunds nobody twice', async () => {
		const store = await storeWithOrder();
		const { stripe, refunds } = fakeStripe();

		await refundCatalogItems({ store, stripe }, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' });
		const again = await refundCatalogItems({ store, stripe }, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' });
		expect(again).toEqual({ refundedItemIds: [], shopperCents: 0, sellerCents: 0, estoriCents: 0 });
		expect(refunds).toHaveLength(1);
	});

	it('remembers a refund whose reversal failed, so a later request with more items reverses it without refunding it again', async () => {
		const store = await storeWithOrder();
		const { stripe, refunds, reversals } = fakeStripe({ failReversals: 1 });

		await expect(refundCatalogItems({ store, stripe }, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' })).rejects.toThrow('Stripe is unavailable');
		expect(itemOf(store, 'ci_cap')).toMatchObject({ status: 'refunded', sellerReversalDueCents: 2800 });

		await refundCatalogItems({ store, stripe }, { orderId: 'co_1', itemIds: ['ci_mug', 'ci_cap'], reason: 'supplier-rejected' });
		expect(refunds.map((refund) => refund.idempotencyKey)).toEqual(['catalog-refund-ci_cap', 'catalog-refund-ci_mug']);
		expect(reversals.map((reversal) => [reversal.idempotencyKey, reversal.amountCents])).toEqual([
			['catalog-reversal-ci_cap', 2800],
			['catalog-reversal-ci_mug', TRANSFERRED_CENTS - 2800],
		]);
		expect(itemOf(store, 'ci_cap')?.sellerReversalDueCents).toBe(0);
	});

	it('keys every Stripe call by one item, whatever the size of the order', async () => {
		const store = memoryCatalogStore();
		const ids = Array.from({ length: 8 }, (_, index) => `0b5d3c2e-6f1a-4c8e-9d7b-${String(index).padStart(12, '0')}`);
		await store.insertPaidOrder({
			id: 'co_big',
			sellerUserId: 'u1',
			storeAppId: 'app_1',
			checkoutSessionId: 'cs_big',
			paymentIntentId: 'pi_big',
			totalCents: 24000,
			catalogTotalCents: 9600,
			applicationFeeCents: 10326,
			destinationCountry: 'US',
			shippingAddress: ADDRESS,
			items: ids.map((id) => ({ id, catalogVariantId: 'cv_pin', supplier: 'cjdropshipping', supplierVariantId: 'cj_pin', quantity: 1, unitPriceCents: 3000, catalogPriceCents: 1200 })),
			createdAt: new Date(0),
		});
		const { stripe, refunds } = fakeStripe();

		await refundCatalogItems({ store, stripe }, { orderId: 'co_big', itemIds: ids.slice(0, 1), reason: 'supplier-rejected' });
		expect(refunds[0].idempotencyKey).toBe(`catalog-refund-${ids[0]}`);
	});

	it('refuses a payment with no transfer to reverse, before refunding anything', async () => {
		const store = await storeWithOrder();
		const { stripe, refunds } = fakeStripe({ transfer: false });

		await expect(refundCatalogItems({ store, stripe }, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' })).rejects.toThrow(
			'The payment has no transfer to the seller',
		);
		expect(refunds).toHaveLength(0);
	});
});
