import { describe, expect, it } from 'vitest';
import { cloudflareSaasProvider, domainProviderFromEnv, localDomainProvider } from './domains';

const ZONE = 'zone_123';
const TARGET = 'stores.estori.shop';

/** Cloudflare's API in memory: records each call and answers with the given bodies in turn. */
function cloudflare(answers: Array<{ status?: number; body: unknown }>) {
	const calls: Array<{ method: string; url: string; body: unknown; auth: string | null }> = [];
	const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
		calls.push({ method: init?.method ?? 'GET', url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null, auth: new Headers(init?.headers).get('Authorization') });
		const answer = answers.shift() ?? { body: { success: true, result: {} } };
		return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
	};
	return { provider: cloudflareSaasProvider({ zoneId: ZONE, apiToken: 'token_abc', cnameTarget: TARGET, fetcher }), calls };
}

const PENDING = {
	success: true,
	result: {
		id: 'ch_1',
		hostname: 'shop.northwindtea.com',
		status: 'pending',
		ownership_verification: { type: 'txt', name: '_cf-custom-hostname.shop.northwindtea.com', value: 'owner-token' },
		ssl: { status: 'pending_validation', validation_records: [{ txt_name: '_acme-challenge.shop.northwindtea.com', txt_value: 'cert-token' }] },
	},
};

describe('the Cloudflare for SaaS provider', () => {
	it('creates the custom hostname on the stores zone, and shows the CNAME and TXT records the seller adds', async () => {
		const { provider, calls } = cloudflare([{ body: PENDING }]);
		const created = await provider.create('shop.northwindtea.com');
		expect(calls).toEqual([
			{
				method: 'POST',
				url: `https://api.cloudflare.com/client/v4/zones/${ZONE}/custom_hostnames`,
				body: { hostname: 'shop.northwindtea.com', ssl: { method: 'txt', type: 'dv', settings: { min_tls_version: '1.2' } } },
				auth: 'Bearer token_abc',
			},
		]);
		expect(created).toEqual({
			providerId: 'ch_1',
			status: 'pending',
			error: null,
			records: [
				{ type: 'CNAME', name: 'shop.northwindtea.com', value: TARGET, purpose: 'routing' },
				{ type: 'TXT', name: '_cf-custom-hostname.shop.northwindtea.com', value: 'owner-token', purpose: 'ownership' },
				{ type: 'TXT', name: '_acme-challenge.shop.northwindtea.com', value: 'cert-token', purpose: 'certificate' },
			],
		});
	});

	it('is connected only once both the hostname and its certificate are active', async () => {
		const sslActive = { ...PENDING, result: { ...PENDING.result, status: 'pending', ssl: { status: 'active', validation_records: [] } } };
		const bothActive = { ...PENDING, result: { ...PENDING.result, status: 'active', ssl: { status: 'active', validation_records: [] } } };
		const { provider, calls } = cloudflare([{ body: sslActive }, { body: bothActive }]);
		expect((await provider.check('shop.northwindtea.com', 'ch_1')).status).toBe('pending');
		expect((await provider.check('shop.northwindtea.com', 'ch_1')).status).toBe('active');
		expect(calls[0]).toMatchObject({ method: 'GET', url: `https://api.cloudflare.com/client/v4/zones/${ZONE}/custom_hostnames/ch_1` });
	});

	it("fails a hostname Cloudflare blocked or whose certificate timed out, with Cloudflare's reason", async () => {
		const blocked = { ...PENDING, result: { ...PENDING.result, status: 'blocked', verification_errors: ['Hostname is on a blocklist'] } };
		const timedOut = { ...PENDING, result: { ...PENDING.result, ssl: { status: 'validation_timed_out', validation_errors: [{ message: 'TXT record not found' }] } } };
		const { provider } = cloudflare([{ body: blocked }, { body: timedOut }]);
		expect(await provider.check('shop.northwindtea.com', 'ch_1')).toMatchObject({ status: 'failed', error: 'Hostname is on a blocklist' });
		expect(await provider.check('shop.northwindtea.com', 'ch_1')).toMatchObject({ status: 'failed', error: 'TXT record not found' });
	});

	it("throws Cloudflare's message when it refuses a request, and treats a hostname already gone as removed", async () => {
		const { provider } = cloudflare([
			{ status: 400, body: { success: false, errors: [{ code: 1411, message: 'Invalid custom hostname.' }] } },
			{ status: 404, body: { success: false, errors: [{ code: 1436, message: 'Custom hostname not found' }] } },
		]);
		await expect(provider.create('shop.northwindtea.com')).rejects.toThrow('Invalid custom hostname.');
		await expect(provider.remove('shop.northwindtea.com', 'ch_gone')).resolves.toBeUndefined();
	});

	it('replaces a hostname left on the zone from before, such as a deleted store\'s, so the domain can be connected again', async () => {
		const { provider, calls } = cloudflare([
			{ status: 409, body: { success: false, errors: [{ code: 1406, message: 'Duplicate custom hostname found.' }] } },
			{ body: { success: true, result: [{ id: 'ch_old', hostname: 'shop.northwindtea.com', status: 'active' }] } },
			{ body: { success: true, result: { id: 'ch_old' } } },
			{ body: PENDING },
		]);
		expect(await provider.create('shop.northwindtea.com')).toMatchObject({ providerId: 'ch_1', status: 'pending' });
		expect(calls.map((call) => `${call.method} ${call.url.replace(`https://api.cloudflare.com/client/v4/zones/${ZONE}/custom_hostnames`, '')}`)).toEqual([
			'POST ',
			'GET ?hostname=shop.northwindtea.com',
			'DELETE /ch_old',
			'POST ',
		]);
	});
});

describe('the local provider', () => {
	it('connects .localhost domains on the first check, so the flow works on a laptop, and nothing else', async () => {
		const provider = localDomainProvider({ cnameTarget: 'stores.localhost' });
		const created = await provider.create('shop.northwindtea.localhost');
		expect(created.status).toBe('pending');
		expect(created.records[0]).toEqual({ type: 'CNAME', name: 'shop.northwindtea.localhost', value: 'stores.localhost', purpose: 'routing' });
		expect((await provider.check('shop.northwindtea.localhost', created.providerId)).status).toBe('active');
		expect(await provider.check('shop.northwindtea.com', null)).toMatchObject({ status: 'failed', error: 'Local development can connect .localhost domains only.' });
	});
});

describe('choosing a provider', () => {
	it('uses Cloudflare for SaaS when it is configured, the local stand-in in development, and none otherwise', () => {
		const saas = { CF_SAAS_ZONE_ID: ZONE, CF_SAAS_API_TOKEN: 'token', STORES_CNAME_TARGET: TARGET, STORES_DOMAIN: 'estori.shop' };
		expect(domainProviderFromEnv({ ...saas, ENVIRONMENT: 'prod' } as unknown as Env)?.name).toBe('cloudflare');
		expect(domainProviderFromEnv({ STORES_DOMAIN: 'stores.localhost', ENVIRONMENT: 'dev' } as unknown as Env)?.name).toBe('local');
		expect(domainProviderFromEnv({ STORES_DOMAIN: 'estori.shop', ENVIRONMENT: 'prod' } as unknown as Env)).toBeNull();
		expect(domainProviderFromEnv({ ...saas, STORES_DOMAIN: '', ENVIRONMENT: 'prod' } as unknown as Env)).toBeNull();
	});
});
