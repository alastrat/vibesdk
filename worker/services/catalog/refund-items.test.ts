import { describe, expect, it } from 'vitest';
import { SellerBalanceShortError, catalogRefundSellerCents, refundCatalogItems, type RefundItemsDeps } from './refund-items';
import { memoryCatalogStore } from './test-support';
import type { StripeClient } from '../payments/stripe-client';

const ADDRESS = { name: 'Ada', line1: '1 Main St', line2: null, city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US', phone: null, email: null };

/** A $90 payment: with an application fee, Stripe transfers the whole charge and takes the fee back separately. */
const TRANSFERRED_CENTS = 9000;

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
function fakeStripe(options: { transfer?: boolean; failReversals?: number; reversed?: number } = {}) {
	const refunds: Array<{ amountCents: number; idempotencyKey: string }> = [];
	const reversals: Array<{ amountCents: number; idempotencyKey: string }> = [];
	let reversed = options.reversed ?? 0;
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

function depsOf(store: RefundItemsDeps['store'], stripe: RefundItemsDeps['stripe'], balance = { availableCents: 100_000, pendingCents: 0 }) {
	const recorded: Array<{ catalogItemId: string; refundId: string; amountCents: number }> = [];
	const shortfalls: Array<{ catalogItemId: string; amountCents: number }> = [];
	const deps: RefundItemsDeps = {
		store,
		stripe,
		sellerBalance: async () => balance,
		recordRefund: async (entry) => void recorded.push({ catalogItemId: entry.catalogItemId, refundId: entry.refundId, amountCents: entry.amountCents }),
		addShortfall: async (shortfall) => void shortfalls.push(shortfall),
	};
	return { deps, recorded, shortfalls };
}

function itemOf(store: Awaited<ReturnType<typeof storeWithOrder>>, itemId: string) {
	return store.orders.get('co_1')?.items.find((item) => item.id === itemId);
}

describe('refundCatalogItems', () => {
	it('refunds rejected items in full, taking back only the seller share', async () => {
		const store = await storeWithOrder();
		const { stripe, refunds, reversals } = fakeStripe();

		const totals = await refundCatalogItems(depsOf(store, stripe).deps, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' });
		expect(totals).toEqual({ refundedItemIds: ['ci_cap'], shopperCents: 4000, sellerCents: 2800, estoriCents: 1200 });
		expect(refunds).toEqual([{ amountCents: 4000, idempotencyKey: 'catalog-refund-ci_cap' }]);
		expect(reversals).toEqual([{ amountCents: 2800, idempotencyKey: 'catalog-reversal-ci_cap' }]);
		expect(itemOf(store, 'ci_cap')).toMatchObject({ status: 'refunded', sellerReversalDueCents: 0 });
	});

	it('charges the whole refund to the seller when the supplier kept the money', async () => {
		const store = await storeWithOrder();
		const { stripe, reversals } = fakeStripe();

		const totals = await refundCatalogItems(depsOf(store, stripe).deps, { orderId: 'co_1', itemIds: ['ci_mug'], reason: 'seller-refund' });
		expect(totals).toMatchObject({ shopperCents: 5000, sellerCents: 5000, estoriCents: 0 });
		expect(reversals[0].amountCents).toBe(5000);
	});

	it("takes back the seller's share of every rejected item, and Estori returns the catalog prices", async () => {
		const store = await storeWithOrder();
		const { stripe, refunds, reversals } = fakeStripe();

		const totals = await refundCatalogItems(depsOf(store, stripe).deps, { orderId: 'co_1', itemIds: ['ci_mug', 'ci_cap'], reason: 'supplier-rejected' });
		expect(refunds.map((refund) => refund.amountCents)).toEqual([4000, 5000]);
		expect(reversals.map((reversal) => reversal.amountCents)).toEqual([2800, 2600]);
		expect(totals).toEqual({ refundedItemIds: ['ci_cap', 'ci_mug'], shopperCents: 9000, sellerCents: 5400, estoriCents: 3600 });
	});

	it("refunds a seller's refund when their Stripe balance covers it exactly, and refuses one cent short before any money moves", async () => {
		const store = await storeWithOrder();
		const { stripe, refunds, reversals } = fakeStripe();

		const short = depsOf(store, stripe, { availableCents: 4000, pendingCents: 999 });
		const error = await refundCatalogItems(short.deps, { orderId: 'co_1', itemIds: ['ci_mug'], reason: 'seller-refund' }).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(SellerBalanceShortError);
		expect((error as SellerBalanceShortError).shortCents).toBe(1);
		expect(refunds).toHaveLength(0);
		expect(reversals).toHaveLength(0);

		const exact = depsOf(store, stripe, { availableCents: 4000, pendingCents: 1000 });
		expect(await refundCatalogItems(exact.deps, { orderId: 'co_1', itemIds: ['ci_mug'], reason: 'seller-refund' })).toMatchObject({ shopperCents: 5000, sellerCents: 5000 });
	});

	it("doesn't ask for the seller's balance when Estori owes the refund", async () => {
		const store = await storeWithOrder();
		const { stripe } = fakeStripe();
		const { deps } = depsOf(store, stripe);
		deps.sellerBalance = async () => {
			throw new Error('The balance was asked for');
		};
		await refundCatalogItems(deps, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' });
		await refundCatalogItems(deps, { orderId: 'co_1', itemIds: ['ci_mug'], reason: 'risk-declined' });
	});

	it('records each refund for the store order', async () => {
		const store = await storeWithOrder();
		const { stripe } = fakeStripe();
		const { deps, recorded } = depsOf(store, stripe);
		await refundCatalogItems(deps, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' });
		expect(recorded).toEqual([{ catalogItemId: 'ci_cap', refundId: 're_1', amountCents: 4000 }]);
	});

	it('skips items already refunded, so a retry refunds nobody twice', async () => {
		const store = await storeWithOrder();
		const { stripe, refunds } = fakeStripe();

		await refundCatalogItems(depsOf(store, stripe).deps, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' });
		const again = await refundCatalogItems(depsOf(store, stripe).deps, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' });
		expect(again).toEqual({ refundedItemIds: [], shopperCents: 0, sellerCents: 0, estoriCents: 0 });
		expect(refunds).toHaveLength(1);
	});

	it('remembers a refund whose reversal failed, so a later request with more items reverses it without refunding it again', async () => {
		const store = await storeWithOrder();
		const { stripe, refunds, reversals } = fakeStripe({ failReversals: 1 });

		await expect(refundCatalogItems(depsOf(store, stripe).deps, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' })).rejects.toThrow('Stripe is unavailable');
		expect(itemOf(store, 'ci_cap')).toMatchObject({ status: 'refunded', sellerReversalDueCents: 2800 });

		await refundCatalogItems(depsOf(store, stripe).deps, { orderId: 'co_1', itemIds: ['ci_mug', 'ci_cap'], reason: 'supplier-rejected' });
		expect(refunds.map((refund) => refund.idempotencyKey)).toEqual(['catalog-refund-ci_cap', 'catalog-refund-ci_mug']);
		expect(reversals.map((reversal) => [reversal.idempotencyKey, reversal.amountCents])).toEqual([
			['catalog-reversal-ci_cap', 2800],
			['catalog-reversal-ci_mug', 2600],
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

		await refundCatalogItems(depsOf(store, stripe).deps, { orderId: 'co_big', itemIds: ids.slice(0, 1), reason: 'supplier-rejected' });
		expect(refunds[0].idempotencyKey).toBe(`catalog-refund-${ids[0]}`);
	});

	it('refuses a payment with no transfer to reverse, before refunding anything', async () => {
		const store = await storeWithOrder();
		const { stripe, refunds } = fakeStripe({ transfer: false });

		await expect(refundCatalogItems(depsOf(store, stripe).deps, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' })).rejects.toThrow(
			'The payment has no transfer to the seller',
		);
		expect(refunds).toHaveLength(0);
	});

	it("charges the seller the share the transfer can no longer cover, instead of Estori paying it", async () => {
		const store = await storeWithOrder();
		const { stripe, reversals } = fakeStripe({ reversed: 9000 - 1000 });
		const { deps, shortfalls } = depsOf(store, stripe);
		await refundCatalogItems(deps, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' });
		expect(reversals.map((reversal) => reversal.amountCents)).toEqual([1000]);
		expect(shortfalls).toEqual([{ catalogItemId: 'ci_cap', amountCents: 1800 }]);
	});

	it('marks the item refunded before recording it, so a failed record never refunds it again', async () => {
		const store = await storeWithOrder();
		const { stripe, refunds } = fakeStripe();
		const { deps } = depsOf(store, stripe);
		deps.recordRefund = async () => {
			throw new Error('D1 is unavailable');
		};
		await expect(refundCatalogItems(deps, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' })).rejects.toThrow('D1 is unavailable');
		expect(itemOf(store, 'ci_cap')?.status).toBe('refunded');
		deps.recordRefund = async () => undefined;
		await refundCatalogItems(deps, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' });
		expect(refunds).toHaveLength(1);
	});

	it('records the shortfall before marking the item refunded, so a failed record is taken on the retry', async () => {
		const store = await storeWithOrder();
		const { stripe, refunds } = fakeStripe({ reversed: 9000 - 1000 });
		const { deps, shortfalls } = depsOf(store, stripe);
		const addShortfall = deps.addShortfall;
		deps.addShortfall = async () => {
			throw new Error('D1 is unavailable');
		};
		await expect(refundCatalogItems(deps, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' })).rejects.toThrow('D1 is unavailable');
		deps.addShortfall = addShortfall;
		await refundCatalogItems(deps, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' });
		expect(shortfalls).toEqual([{ catalogItemId: 'ci_cap', amountCents: 1800 }]);
		// The retry reuses the item's key, so Stripe answers it with the same refund.
		expect(new Set(refunds.map((refund) => refund.idempotencyKey))).toEqual(new Set(['catalog-refund-ci_cap']));
	});

	it("plans what a seller refund would take back without moving money, so a mixed refund checks the balance once", async () => {
		const store = await storeWithOrder();
		const { stripe, refunds, reversals } = fakeStripe();
		const { deps } = depsOf(store, stripe);
		expect(await catalogRefundSellerCents(deps, { orderId: 'co_1', itemIds: ['ci_mug', 'ci_cap'], reason: 'seller-refund' })).toBe(9000);
		expect(refunds).toHaveLength(0);
		expect(reversals).toHaveLength(0);
	});
});
