import { describe, expect, it } from 'vitest';
import { MAX_PLACEMENT_ATTEMPTS, nextRetryDelayMs, placeCatalogOrder } from './placement';
import { memoryCatalogStore } from './test-support';
import type { PlaceOrderResult, SupplierAdapter } from './supplier';

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

/** An adapter that answers each call in turn and remembers what it was sent. */
function scriptedAdapter(results: PlaceOrderResult[]) {
	const calls: Array<{ orderReference: string; variants: string[] }> = [];
	const adapter: SupplierAdapter = {
		supplier: 'cjdropshipping',
		async placeOrder(input) {
			calls.push({ orderReference: input.orderReference, variants: input.lines.map((line) => line.supplierVariantId) });
			const result = results.shift();
			if (!result) throw new Error('No scripted result left');
			return result;
		},
	};
	return { adapter, calls };
}

describe('nextRetryDelayMs', () => {
	it('backs off from a minute to three hours', () => {
		expect([1, 2, 3, 4, 5, 9].map(nextRetryDelayMs)).toEqual([60_000, 300_000, 900_000, 3_600_000, 10_800_000, 10_800_000]);
	});
});

describe('placeCatalogOrder', () => {
	it('places every pending item with one supplier order and finishes', async () => {
		const store = await storeWithOrder();
		const { adapter, calls } = scriptedAdapter([{ ok: true, supplierOrderId: 'cj_9' }]);

		expect(await placeCatalogOrder({ store, adapters: { cjdropshipping: adapter } }, 'co_1')).toEqual({ kind: 'done', rejectedItemIds: [] });
		expect(calls).toEqual([{ orderReference: 'co_1', variants: ['cj_mug', 'cj_cap'] }]);
		expect(store.orders.get('co_1')?.items.map((item) => [item.status, item.supplierOrderId])).toEqual([
			['placed', 'cj_9'],
			['placed', 'cj_9'],
		]);
		expect(store.orders.get('co_1')?.status).toBe('placement-done');
	});

	it('rejects the named variants and places the rest straight away', async () => {
		const store = await storeWithOrder();
		const { adapter, calls } = scriptedAdapter([
			{ ok: false, kind: 'rejected', reason: 'Out of stock', rejectedVariantIds: ['cj_cap'] },
			{ ok: true, supplierOrderId: 'cj_10' },
		]);

		expect(await placeCatalogOrder({ store, adapters: { cjdropshipping: adapter } }, 'co_1')).toEqual({ kind: 'done', rejectedItemIds: ['ci_cap'] });
		expect(calls.map((call) => call.variants)).toEqual([['cj_mug', 'cj_cap'], ['cj_mug']]);
		expect(store.orders.get('co_1')?.items.map((item) => item.status)).toEqual(['placed', 'rejected']);
	});

	it('rejects every line sent when a rejection names none of them', async () => {
		const store = await storeWithOrder();
		const { adapter } = scriptedAdapter([{ ok: false, kind: 'rejected', reason: 'Undeliverable address', rejectedVariantIds: ['cj_unknown'] }]);

		expect(await placeCatalogOrder({ store, adapters: { cjdropshipping: adapter } }, 'co_1')).toEqual({
			kind: 'done',
			rejectedItemIds: ['ci_mug', 'ci_cap'],
		});
	});

	it('schedules a retry on a temporary failure, with the same order reference next time', async () => {
		const store = await storeWithOrder();
		const { adapter, calls } = scriptedAdapter([
			{ ok: false, kind: 'retryable', reason: 'Timed out' },
			{ ok: true, supplierOrderId: 'cj_11' },
		]);
		const deps = { store, adapters: { cjdropshipping: adapter } };

		expect(await placeCatalogOrder(deps, 'co_1')).toEqual({ kind: 'retry', delayMs: 60_000 });
		expect(store.orders.get('co_1')).toMatchObject({ status: 'awaiting-placement', placementAttempts: 1, lastError: 'Timed out' });
		expect(await placeCatalogOrder(deps, 'co_1')).toEqual({ kind: 'done', rejectedItemIds: [] });
		expect(calls.map((call) => call.orderReference)).toEqual(['co_1', 'co_1']);
	});

	it('hands the order to the owner after the last attempt fails', async () => {
		const store = await storeWithOrder();
		const failures: PlaceOrderResult[] = Array.from({ length: MAX_PLACEMENT_ATTEMPTS }, () => ({ ok: false, kind: 'retryable', reason: 'Supplier down' }));
		const { adapter } = scriptedAdapter(failures);
		const deps = { store, adapters: { cjdropshipping: adapter } };

		for (let attempt = 1; attempt < MAX_PLACEMENT_ATTEMPTS; attempt += 1) expect((await placeCatalogOrder(deps, 'co_1')).kind).toBe('retry');
		expect(await placeCatalogOrder(deps, 'co_1')).toEqual({ kind: 'needs-attention', reason: 'Supplier down' });
		expect(store.orders.get('co_1')?.status).toBe('needs-attention');
	});

	it('does nothing for an order with nothing left to place, or no order at all', async () => {
		const store = await storeWithOrder();
		const { adapter, calls } = scriptedAdapter([{ ok: true, supplierOrderId: 'cj_12' }]);
		const deps = { store, adapters: { cjdropshipping: adapter } };

		await placeCatalogOrder(deps, 'co_1');
		expect(await placeCatalogOrder(deps, 'co_1')).toEqual({ kind: 'done', rejectedItemIds: [] });
		expect(calls).toHaveLength(1);
		expect(await placeCatalogOrder(deps, 'co_missing')).toEqual({ kind: 'not-found' });
	});
});
