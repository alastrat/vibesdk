import { describe, expect, it } from 'vitest';
import { RUNNER_SYNC_INTERVAL_MS, initialRunnerState, runnerStep, sweepUnstartedOrders, type RunnerDeps } from './runner';
import { memoryCatalogStore } from './test-support';
import type { PlaceOrderResult, SupplierAdapter, SupplierUpdate } from './supplier';
import type { StripeClient } from '../payments/stripe-client';

const NOW = 1_800_000_000_000;
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

function deps(store: Awaited<ReturnType<typeof storeWithOrder>>, results: PlaceOrderResult[], updates: SupplierUpdate[][] = [], reversedCents = 0) {
	const refunds: number[] = [];
	const shortfalls: Array<{ catalogItemId: string; amountCents: number }> = [];
	const alerts: string[] = [];
	const adapter: SupplierAdapter = {
		supplier: 'cjdropshipping',
		placeOrder: async () => results.shift() ?? { ok: false, kind: 'retryable', reason: 'No scripted result' },
	};
	const stripe: Pick<StripeClient, 'retrievePaymentIntent' | 'createRefund' | 'createTransferReversal'> = {
		retrievePaymentIntent: async (id) => ({ id, latest_charge: { id: 'ch_1', transfer: { id: 'tr_1', amount: 5109, amount_reversed: reversedCents } } }),
		createRefund: async (input) => {
			refunds.push(input.amountCents);
			return { id: 're_1', amount: input.amountCents, status: 'succeeded' };
		},
		createTransferReversal: async (input) => ({ id: 'trr_1', amount: input.amountCents }),
	};
	const runnerDeps: RunnerDeps = {
		store,
		adapters: { cjdropshipping: adapter },
		stripe,
		supplierUpdates: async () => updates.shift() ?? [],
		alert: async (alert) => void alerts.push(alert.kind),
		recordRefund: async () => undefined,
		addShortfall: async (shortfall) => void shortfalls.push(shortfall),
	};
	return { runnerDeps, refunds, alerts, shortfalls };
}

describe('runnerStep', () => {
	it('places the order, then polls the supplier on its interval', async () => {
		const store = await storeWithOrder();
		const { runnerDeps } = deps(store, [{ ok: true, supplierOrderId: 'cj_9' }]);

		const first = await runnerStep(initialRunnerState('co_1', NOW), runnerDeps, NOW);
		expect(first.state.placement).toBe('done');
		expect(first.nextAlarmAt).toBe(NOW + RUNNER_SYNC_INTERVAL_MS);
		expect(store.orders.get('co_1')?.items.map((item) => item.status)).toEqual(['placed', 'placed']);
	});

	it('waits the retry delay after a temporary failure', async () => {
		const store = await storeWithOrder();
		const { runnerDeps } = deps(store, [{ ok: false, kind: 'retryable', reason: 'Timed out' }]);

		const step = await runnerStep(initialRunnerState('co_1', NOW), runnerDeps, NOW);
		expect(step.state).toMatchObject({ placement: 'due', nextPlacementAt: NOW + 60_000 });
		expect(step.nextAlarmAt).toBe(NOW + 60_000);
	});

	it('refunds rejected items from the stored state, including ones rejected by an attempt that then retried', async () => {
		const store = await storeWithOrder();
		const { runnerDeps, refunds } = deps(store, [
			{ ok: false, kind: 'rejected', reason: 'Out of stock', rejectedVariantIds: ['cj_cap'] },
			{ ok: false, kind: 'retryable', reason: 'Timed out' },
		]);

		const step = await runnerStep(initialRunnerState('co_1', NOW), runnerDeps, NOW);
		expect(refunds).toEqual([4000]);
		expect(store.orders.get('co_1')?.items.map((item) => item.status)).toEqual(['pending', 'refunded']);
		expect(step.state.placement).toBe('due');
	});

	it('applies tracking and delivery from the supplier, and stops polling once everything arrived', async () => {
		const store = await storeWithOrder();
		const { runnerDeps } = deps(store, [{ ok: true, supplierOrderId: 'cj_9' }], [
			[{ kind: 'shipped', supplierOrderId: 'cj_9', trackingNumber: 'SBX1', carrier: 'USPS' }],
			[{ kind: 'shipped', supplierOrderId: 'cj_9', trackingNumber: 'SBX1', carrier: 'USPS' }, { kind: 'delivered', supplierOrderId: 'cj_9' }],
		]);

		let step = await runnerStep(initialRunnerState('co_1', NOW), runnerDeps, NOW);
		step = await runnerStep(step.state, runnerDeps, NOW + RUNNER_SYNC_INTERVAL_MS);
		expect(store.orders.get('co_1')?.items.map((item) => [item.status, item.trackingNumber, item.carrier])).toEqual([
			['shipped', 'SBX1', 'USPS'],
			['shipped', 'SBX1', 'USPS'],
		]);
		step = await runnerStep(step.state, runnerDeps, NOW + 2 * RUNNER_SYNC_INTERVAL_MS);
		expect(store.orders.get('co_1')?.items.map((item) => item.status)).toEqual(['delivered', 'delivered']);
		expect(step.nextAlarmAt).toBeNull();
	});

	it("charges the seller what the sale's transfer can no longer cover when a rejected item is refunded", async () => {
		const store = await storeWithOrder();
		const { runnerDeps, shortfalls } = deps(store, [{ ok: false, kind: 'rejected', reason: 'Out of stock', rejectedVariantIds: ['cj_cap'] }], [], 5109 - 1000);

		await runnerStep(initialRunnerState('co_1', NOW), runnerDeps, NOW);
		expect(shortfalls).toEqual([{ catalogItemId: 'ci_cap', amountCents: 1800 }]);
	});

	it('refunds items the supplier cancels after payment', async () => {
		const store = await storeWithOrder();
		const { runnerDeps, refunds, alerts } = deps(store, [{ ok: true, supplierOrderId: 'cj_9' }], [[{ kind: 'cancelled', supplierOrderId: 'cj_9', supplierVariantIds: [], reason: 'Cancelled' }]]);

		const first = await runnerStep(initialRunnerState('co_1', NOW), runnerDeps, NOW);
		await runnerStep(first.state, runnerDeps, NOW + RUNNER_SYNC_INTERVAL_MS);
		expect(refunds.sort()).toEqual([4000, 5000]);
		expect(store.orders.get('co_1')?.items.every((item) => item.status === 'refunded')).toBe(true);
		expect(alerts).toContain('supplier-cancelled');
	});

	it('hands a refund that keeps failing to the owner', async () => {
		const store = await storeWithOrder();
		const { runnerDeps, alerts } = deps(store, [{ ok: false, kind: 'rejected', reason: 'Gone', rejectedVariantIds: [] }]);
		runnerDeps.stripe = { ...runnerDeps.stripe!, createRefund: async () => Promise.reject(new Error('Stripe down')) };

		let step = await runnerStep(initialRunnerState('co_1', NOW), runnerDeps, NOW);
		// Alarms run until none is set; the tracking sync takes one of them.
		for (let alarm = 0; alarm < 10 && step.nextAlarmAt !== null; alarm += 1) step = await runnerStep(step.state, runnerDeps, step.nextAlarmAt);
		expect(step.state.refundFailures).toBe(6);
		expect(store.orders.get('co_1')?.status).toBe('needs-attention');
		expect(alerts).toContain('refund-failed');
	});

	it('backs a failing step off instead of retrying it every second', async () => {
		const store = await storeWithOrder();
		const { runnerDeps } = deps(store, [{ ok: true, supplierOrderId: 'cj_9' }]);
		runnerDeps.supplierUpdates = async () => Promise.reject(new Error('Supplier unreachable'));

		const placed = await runnerStep(initialRunnerState('co_1', NOW), runnerDeps, NOW);
		const failed = await runnerStep(placed.state, runnerDeps, NOW + RUNNER_SYNC_INTERVAL_MS);
		expect(failed.nextAlarmAt).toBeGreaterThanOrEqual(NOW + RUNNER_SYNC_INTERVAL_MS + 60_000);
	});

	it('waits instead of looping when Stripe is not configured for a refund', async () => {
		const store = await storeWithOrder();
		const { runnerDeps } = deps(store, [{ ok: false, kind: 'rejected', reason: 'Gone', rejectedVariantIds: [] }]);
		runnerDeps.stripe = null;

		const step = await runnerStep(initialRunnerState('co_1', NOW), runnerDeps, NOW);
		expect(step.nextAlarmAt).toBeGreaterThanOrEqual(NOW + 60_000);
	});

	it("takes back a seller's share still owed after the shopper was refunded", async () => {
		const store = await storeWithOrder();
		const reversals: number[] = [];
		const { runnerDeps } = deps(store, [{ ok: true, supplierOrderId: 'cj_9' }]);
		runnerDeps.stripe = { ...runnerDeps.stripe!, createTransferReversal: async (input) => (reversals.push(input.amountCents), { id: 'trr_1', amount: input.amountCents }) };
		await store.patchItems([{ itemId: 'ci_cap', status: 'refunded', sellerReversalDueCents: 2800 }]);

		const step = await runnerStep(initialRunnerState('co_1', NOW), runnerDeps, NOW);
		expect(reversals).toEqual([2800]);
		expect(store.orders.get('co_1')?.items.find((item) => item.id === 'ci_cap')?.sellerReversalDueCents).toBe(0);
		expect(step.state.placement).toBe('done');
	});
});

describe('sweepUnstartedOrders', () => {
	it('starts every paid catalog order whose hand-off was lost', async () => {
		const started: string[] = [];
		const count = await sweepUnstartedOrders({ unstartedOrderIds: async () => ['co_1', 'co_2'], start: async (orderId) => void started.push(orderId) }, NOW);
		expect(count).toBe(2);
		expect(started).toEqual(['co_1', 'co_2']);
	});
});
