import { describe, expect, it } from 'vitest';
import { resolveGatewayAuth, resolveThinkGateway } from './gateway-auth';

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

describe('resolveThinkGateway', () => {
	const conf = { baseURL: 'https://resolved.example/compat', apiKey: 'google-key-0123456789', defaultHeaders: { 'cf-aig-authorization': 'Bearer gateway-token' } };

	it('addresses the gateway by account and gateway id, ignoring the resolved url', () => {
		const gateway = resolveThinkGateway(conf, { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_AI_GATEWAY: 'estori-gateway', CLOUDFLARE_AI_GATEWAY_TOKEN: 'gateway-token' });
		expect(gateway).toEqual({
			baseURL: 'https://gateway.ai.cloudflare.com/v1/acct/estori-gateway/compat',
			apiKey: 'google-key-0123456789',
			headers: { 'cf-aig-authorization': 'Bearer gateway-token' },
			useStoredKeys: false,
		});
	});

	it('keeps the resolved url when the account or gateway id is missing, and falls back to the API token', () => {
		const gateway = resolveThinkGateway({ baseURL: conf.baseURL, apiKey: 'api-token' }, { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'api-token' });
		expect(gateway).toEqual({ baseURL: 'https://resolved.example/compat', apiKey: 'api-token', headers: { 'cf-aig-authorization': 'Bearer api-token' }, useStoredKeys: true });
	});
});
