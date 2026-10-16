import { describe, expect, it } from 'vitest';
import { cjShippingFields } from './address';
import { createCjClient } from './client';
import { cjOrderNumber } from './order-number';

const ADDRESS = {
	name: '  Ada Lovelace with a very long name that goes on past fifty characters  ',
	line1: '1 Main St',
	line2: null,
	city: 'Austin',
	region: 'TX',
	postalCode: '78701',
	countryCode: 'US',
	phone: '+1 (512) 555-0100',
	email: 'ada@example.com',
};

describe('cjOrderNumber', () => {
	it('derives one number per order and set of lines, whatever their order', async () => {
		const reference = '0b5d3c2e-6f1a-4c8e-9d7b-000000000001';
		const a = await cjOrderNumber(reference, [{ supplierVariantId: 'v2', quantity: 1 }, { supplierVariantId: 'v1', quantity: 2 }]);
		const b = await cjOrderNumber(reference, [{ supplierVariantId: 'v1', quantity: 2 }, { supplierVariantId: 'v2', quantity: 1 }]);
		const c = await cjOrderNumber(reference, [{ supplierVariantId: 'v1', quantity: 2 }]);
		expect(a).toBe(b);
		expect(c).not.toBe(a);
		expect(a).toMatch(new RegExp(`^${reference}-[0-9a-f]{8}$`));
		expect(a.length).toBeLessThanOrEqual(50);
	});
});

describe('cjShippingFields', () => {
	it("maps the shopper's address, cutting lengths and never sending the email", () => {
		const fields = cjShippingFields(ADDRESS, 'United States');
		expect(fields).toEqual({
			shippingCustomerName: 'Ada Lovelace with a very long name that goes on pa',
			shippingAddress: '1 Main St',
			shippingCity: 'Austin',
			shippingProvince: 'TX',
			shippingZip: '78701',
			shippingCountryCode: 'US',
			shippingCountry: 'United States',
			shippingPhone: '+15125550100',
		});
		expect(JSON.stringify(fields)).not.toContain('ada@example.com');
		expect(cjShippingFields({ ...ADDRESS, region: null, line2: 'Unit 4', phone: null }, 'United States')).toMatchObject({ shippingProvince: 'Austin', shippingAddress2: 'Unit 4' });
	});
});

describe('the CJ order endpoints', () => {
	function scripted(answers: unknown[]) {
		const calls: Array<{ url: string; body: unknown }> = [];
		const fakeFetch: typeof fetch = async (input, init) => {
			calls.push({ url: String(input), body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
			return new Response(JSON.stringify(answers.shift()), { status: 200 });
		};
		const session = { token: async () => ({ accessToken: 't', accessTokenExpiresAt: 2_000_000_000_000, openId: '1' }), refresh: async () => ({ accessToken: 't', accessTokenExpiresAt: 2_000_000_000_000, openId: '1' }) };
		return { calls, client: createCjClient({ session, fetchImpl: fakeFetch, sleep: async () => {}, minIntervalMs: 0 }) };
	}

	it('reads an order by its number, and answers null when CJ has none', async () => {
		const { calls, client } = scripted([
			{ code: 200, message: 'Success', data: { orderId: 'cj_1', orderNum: 'n-1', orderStatus: 'UNSHIPPED', trackNumber: null, trackingProvider: null, logisticName: 'USPS', orderAmount: 16.9, productList: [{ vid: 'v1', quantity: 1 }] } },
			{ code: 1603001, message: 'Order not found', data: null },
			{ code: 200, message: 'Success', data: null },
		]);
		expect(await client.getOrderDetail('n-1')).toMatchObject({ orderId: 'cj_1', orderStatus: 'UNSHIPPED' });
		expect(calls[0].url).toBe('https://developers.cjdropshipping.com/api2.0/v1/shopping/order/getOrderDetail?orderId=n-1');
		expect(await client.getOrderDetail('n-2')).toBeNull();
		expect(await client.getOrderDetail('n-3')).toBeNull();
	});

	it('pays sandbox orders by simulation and moves them through the sandbox statuses', async () => {
		const { calls, client } = scripted([{ code: 200, data: true }, { code: 200, data: true }, { code: 200, data: true }]);
		await client.simulatePay('cj_1');
		await client.sandboxUpdateStatus('cj_1', 500);
		await client.sandboxUpdateTrackNumber('cj_1', 'SBX123');
		expect(calls.map((call) => [call.url.split('/v1/')[1], call.body])).toEqual([
			['shopping/sandbox/simulatePay', { orderId: 'cj_1' }],
			['shopping/sandbox/updateStatus', { orderId: 'cj_1', targetStatus: 500 }],
			['shopping/sandbox/updateTrackNumber', { orderId: 'cj_1', trackNumber: 'SBX123' }],
		]);
	});
});
