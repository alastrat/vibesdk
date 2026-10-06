import { describe, expect, it } from 'vitest';
import { resolveGatewayAuth } from './gateway-auth';

describe('resolveGatewayAuth', () => {
	it('keeps the provider key when the platform holds one', () => {
		const auth = resolveGatewayAuth(
			{ apiKey: 'google-key', defaultHeaders: { 'cf-aig-authorization': 'Bearer gateway-token' } },
			'gateway-token',
		);
		expect(auth).toEqual({
			apiKey: 'google-key',
			headers: { 'cf-aig-authorization': 'Bearer gateway-token' },
			useStoredKeys: false,
		});
	});

	it('switches to gateway stored keys when the platform has no provider key', () => {
		const auth = resolveGatewayAuth({ apiKey: 'gateway-token' }, 'gateway-token');
		expect(auth).toEqual({
			apiKey: 'gateway-token',
			headers: { 'cf-aig-authorization': 'Bearer gateway-token' },
			useStoredKeys: true,
		});
	});

	it('omits gateway authorization when there is no gateway token', () => {
		const auth = resolveGatewayAuth({ apiKey: 'some-key' }, undefined);
		expect(auth).toEqual({ apiKey: 'some-key', headers: undefined, useStoredKeys: true });
	});
});
