import { describe, expect, it } from 'vitest';
import { resolveGatewayAuth, resolveThinkGateway, storedKeysFetch } from './gateway-auth';

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

describe('storedKeysFetch', () => {
	function recorded() {
		const seen: { input: RequestInfo | URL; init: RequestInit | undefined }[] = [];
		const base: typeof fetch = async (input, init) => {
			seen.push({ input, init });
			return new Response('ok');
		};
		return { seen, base };
	}
	const headers = { authorization: 'Bearer provider-key', 'cf-aig-authorization': 'Bearer gateway-token', 'content-type': 'application/json' };

	it('never forwards Authorization when the gateway holds the provider keys, and keeps the gateway token and everything else', async () => {
		const { seen, base } = recorded();
		await storedKeysFetch(true, base)('https://gateway.example/chat', { method: 'POST', body: '{}', headers });
		const sent = new Headers(seen[0].init?.headers);
		expect(sent.get('authorization')).toBeNull();
		expect(sent.get('cf-aig-authorization')).toBe('Bearer gateway-token');
		expect(sent.get('content-type')).toBe('application/json');
		expect(seen[0]).toMatchObject({ input: 'https://gateway.example/chat', init: { method: 'POST', body: '{}' } });
	});

	it("leaves Authorization alone when the platform's own provider key is used", async () => {
		const { seen, base } = recorded();
		await storedKeysFetch(false, base)('https://gateway.example/chat', { headers });
		expect(new Headers(seen[0].init?.headers).get('authorization')).toBe('Bearer provider-key');
	});

	it('works for a request with no init', async () => {
		const { seen, base } = recorded();
		await storedKeysFetch(true, base)('https://gateway.example/chat');
		expect(new Headers(seen[0].init?.headers).get('authorization')).toBeNull();
	});
});
