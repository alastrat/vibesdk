import { describe, expect, it } from 'vitest';
import { CJDropshippingAdapter, type CjAdapterDeps, type SupplierAlert } from './adapter';
import { CjApiError } from './errors';
import { cjOrderNumber } from './order-number';
import type { CjCreateOrderRequest, CjOrderDetail } from './types';

const ADDRESS = { name: 'Ada', line1: '1 Main St', line2: null, city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US', phone: null, email: 'ada@example.com' };
const LINES = [{ supplierVariantId: 'v1', quantity: 2 }];
const REFERENCE = 'co_1';

function detail(status: string, lines = [{ vid: 'v1', quantity: 2 }]): CjOrderDetail {
	return { orderId: 'cj_1', orderNum: 'n', orderStatus: status, trackNumber: null, trackingProvider: null, logisticName: 'USPS', orderAmount: 33.8, productList: lines };
}

function fakeClient(script: { existing?: CjOrderDetail | null; afterPay?: CjOrderDetail; create?: () => Promise<{ orderId: string; shipmentOrderId: string | null; orderStatus: string | null; interceptOrderReasons: null | Array<{ code: number; message: string }> }> } = {}) {
	const created: CjCreateOrderRequest[] = [];
	const paid: string[] = [];
	const balancePaid: string[] = [];
	let reads = 0;
	const client: CjAdapterDeps['client'] = {
		getOrderDetail: async () => {
			reads += 1;
			if (reads === 1) return script.existing ?? null;
			return script.afterPay ?? detail('UNSHIPPED');
		},
		freightCalculate: async () => [{ logisticName: 'USPS US to US', logisticAging: '3-5', totalPostageFee: 0, logisticPrice: 0 }],
		createOrder: async (input) => {
			created.push(input);
			return script.create ? script.create() : { orderId: 'cj_1', shipmentOrderId: 'ship_1', orderStatus: 'CREATED', interceptOrderReasons: null };
		},
		simulatePay: async (orderId) => {
			paid.push(orderId);
		},
		payBalance: async (shipmentOrderId) => {
			balancePaid.push(shipmentOrderId);
		},
	};
	return { client, created, paid, balancePaid };
}

function adapterWith(client: CjAdapterDeps['client'], mode: 'live' | 'sandbox' = 'sandbox') {
	const alerts: SupplierAlert[] = [];
	const adapter = new CJDropshippingAdapter({ client, destinations: { US: { name: 'United States', origin: 'US' } }, mode, alert: async (alert) => void alerts.push(alert) });
	return { adapter, alerts };
}

describe('CJDropshippingAdapter', () => {
	it('creates a sandbox order outside production, pays it by simulation, and confirms it', async () => {
		const { client, created, paid, balancePaid } = fakeClient();
		const { adapter } = adapterWith(client);

		expect(await adapter.placeOrder({ orderReference: REFERENCE, lines: LINES, address: ADDRESS })).toEqual({ ok: true, supplierOrderId: 'cj_1' });
		expect(created[0]).toMatchObject({
			orderNumber: await cjOrderNumber(REFERENCE, LINES),
			payType: 3,
			isSandbox: 1,
			logisticName: 'USPS US to US',
			fromCountryCode: 'US',
			shippingCountryCode: 'US',
			products: [{ vid: 'v1', quantity: 2 }],
		});
		expect(JSON.stringify(created[0])).not.toContain('ada@example.com');
		expect(paid).toEqual(['cj_1']);
		expect(balancePaid).toEqual([]);
	});

	it('returns the paid order a timed-out attempt left behind, without creating another', async () => {
		const { client, created } = fakeClient({ existing: detail('UNSHIPPED') });
		const { adapter } = adapterWith(client);
		expect(await adapter.placeOrder({ orderReference: REFERENCE, lines: LINES, address: ADDRESS })).toEqual({ ok: true, supplierOrderId: 'cj_1' });
		expect(created).toHaveLength(0);
	});

	it('pays an unpaid order it finds only when its lines match, and alerts otherwise', async () => {
		const matching = fakeClient({ existing: detail('UNPAID') });
		expect(await adapterWith(matching.client).adapter.placeOrder({ orderReference: REFERENCE, lines: LINES, address: ADDRESS })).toEqual({ ok: true, supplierOrderId: 'cj_1' });
		expect(matching.paid).toEqual(['cj_1']);

		const different = fakeClient({ existing: detail('UNPAID', [{ vid: 'v9', quantity: 1 }]) });
		const { adapter, alerts } = adapterWith(different.client);
		expect(await adapter.placeOrder({ orderReference: REFERENCE, lines: LINES, address: ADDRESS })).toMatchObject({ ok: false, kind: 'retryable' });
		expect(different.paid).toEqual([]);
		expect(alerts.map((alert) => alert.kind)).toEqual(['lines-mismatch']);
	});

	it('rejects what CJ cannot fill, and retries what may pass', async () => {
		const unavailable = fakeClient({ create: async () => Promise.reject(new CjApiError('Variant off sale', 200, 1602001, 'r')) });
		expect(await adapterWith(unavailable.client).adapter.placeOrder({ orderReference: REFERENCE, lines: LINES, address: ADDRESS })).toEqual({
			ok: false,
			kind: 'rejected',
			reason: 'Variant off sale',
			rejectedVariantIds: [],
		});

		const unfunded = fakeClient({ create: async () => Promise.reject(new CjApiError('Balance too low', 200, 1604000, 'r')) });
		const funded = adapterWith(unfunded.client);
		expect(await funded.adapter.placeOrder({ orderReference: REFERENCE, lines: LINES, address: ADDRESS })).toMatchObject({ ok: false, kind: 'retryable' });
		expect(funded.alerts.map((alert) => alert.kind)).toEqual(['low-balance']);

		const cancelled = fakeClient({ existing: detail('CANCELLED') });
		expect(await adapterWith(cancelled.client).adapter.placeOrder({ orderReference: REFERENCE, lines: LINES, address: ADDRESS })).toMatchObject({ ok: false, kind: 'rejected', rejectedVariantIds: [] });
	});

	it('holds an order CJ intercepts, never paying it', async () => {
		const held = fakeClient({ create: async () => ({ orderId: 'cj_1', shipmentOrderId: null, orderStatus: 'CREATED', interceptOrderReasons: [{ code: 1001, message: 'Address check' }] }) });
		const { adapter, alerts } = adapterWith(held.client);
		expect(await adapter.placeOrder({ orderReference: REFERENCE, lines: LINES, address: ADDRESS })).toMatchObject({ ok: false, kind: 'retryable' });
		expect(held.paid).toEqual([]);
		expect(alerts.map((alert) => alert.kind)).toEqual(['held-order']);
	});

	it('pays live orders from the balance only in live mode', async () => {
		const { client, paid, balancePaid, created } = fakeClient();
		await adapterWith(client, 'live').adapter.placeOrder({ orderReference: REFERENCE, lines: LINES, address: ADDRESS });
		expect(created[0].isSandbox).toBe(0);
		expect(paid).toEqual([]);
		expect(balancePaid).toEqual(['ship_1']);
	});

	it('refuses destinations the catalog does not serve', async () => {
		const { client, created } = fakeClient();
		expect(await adapterWith(client).adapter.placeOrder({ orderReference: REFERENCE, lines: LINES, address: { ...ADDRESS, countryCode: 'FR' } })).toMatchObject({ ok: false, kind: 'rejected' });
		expect(created).toHaveLength(0);
	});
});
