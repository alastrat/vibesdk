import { describe, expect, it } from 'vitest';
import { runSmokeChecks, type SmokeConfig } from './estori-smoke';

const CONFIG: SmokeConfig = {
	appOrigin: 'https://app.getestori.com',
	previewProbeUrl: 'https://smoke.apps.getestori.com/',
	apexUrl: 'https://getestori.com/',
	accessClientId: 'id',
	accessClientSecret: 'secret',
};

type Route = (init?: RequestInit) => Response;

function fakeFetch(routes: Record<string, Route>) {
	const seen: Array<{ url: string; headers: Headers }> = [];
	const impl = async (url: string, init?: RequestInit): Promise<Response> => {
		seen.push({ url, headers: new Headers(init?.headers) });
		const route = routes[url];
		if (!route) throw new Error(`unexpected fetch ${url}`);
		return route(init);
	};
	return { impl, seen };
}

const healthy: Record<string, Route> = {
	'https://app.getestori.com/api/health': () => Response.json({ status: 'ok' }),
	'https://app.getestori.com/api/capabilities': () =>
		Response.json({ success: true, data: { platformDeploy: false, artifacts: true } }),
	'https://smoke.apps.getestori.com/': () =>
		new Response('not found', { status: 404, headers: { server: 'cloudflare' } }),
	'https://getestori.com/': () => new Response('<html>', { status: 200, headers: { server: 'Vercel' } }),
};

describe('runSmokeChecks', () => {
	it('passes every check against a healthy deployment', async () => {
		const { impl } = fakeFetch(healthy);
		const results = await runSmokeChecks(CONFIG, impl);
		expect(results.map((r) => [r.name, r.ok])).toEqual([
			['health', true],
			['capabilities', true],
			['preview-host', true],
			['marketing-apex', true],
		]);
	});

	it('sends Access service-token headers to the app host only', async () => {
		const { impl, seen } = fakeFetch(healthy);
		await runSmokeChecks(CONFIG, impl);
		const app = seen.filter((s) => s.url.startsWith(CONFIG.appOrigin));
		const other = seen.filter((s) => !s.url.startsWith(CONFIG.appOrigin));
		expect(app.every((s) => s.headers.get('CF-Access-Client-Id') === 'id')).toBe(true);
		expect(app.every((s) => s.headers.get('CF-Access-Client-Secret') === 'secret')).toBe(true);
		expect(other.every((s) => s.headers.get('CF-Access-Client-Id') === null)).toBe(true);
	});

	it('fails health on a non-ok status', async () => {
		const { impl } = fakeFetch({ ...healthy, 'https://app.getestori.com/api/health': () => new Response('down', { status: 503 }) });
		const health = (await runSmokeChecks(CONFIG, impl)).find((r) => r.name === 'health');
		expect(health?.ok).toBe(false);
	});

	it('fails capabilities when platform deploy is exposed or artifacts is off', async () => {
		const { impl } = fakeFetch({
			...healthy,
			'https://app.getestori.com/api/capabilities': () =>
				Response.json({ success: true, data: { platformDeploy: true, artifacts: false } }),
		});
		const caps = (await runSmokeChecks(CONFIG, impl)).find((r) => r.name === 'capabilities');
		expect(caps?.ok).toBe(false);
	});

	it('fails the preview check when Access redirects it or Vercel answers', async () => {
		const accessRedirect = fakeFetch({
			...healthy,
			'https://smoke.apps.getestori.com/': () =>
				new Response(null, { status: 302, headers: { server: 'cloudflare', location: 'https://estori.cloudflareaccess.com/cdn-cgi/access/login' } }),
		});
		const vercel = fakeFetch({
			...healthy,
			'https://smoke.apps.getestori.com/': () => new Response('x', { status: 404, headers: { server: 'Vercel' } }),
		});
		expect((await runSmokeChecks(CONFIG, accessRedirect.impl)).find((r) => r.name === 'preview-host')?.ok).toBe(false);
		expect((await runSmokeChecks(CONFIG, vercel.impl)).find((r) => r.name === 'preview-host')?.ok).toBe(false);
	});

	it('reports a thrown fetch (for example a TLS failure) as a failed check', async () => {
		const { impl } = fakeFetch({
			...healthy,
			'https://smoke.apps.getestori.com/': () => {
				throw new Error('certificate has expired');
			},
		});
		const preview = (await runSmokeChecks(CONFIG, impl)).find((r) => r.name === 'preview-host');
		expect(preview).toEqual({ name: 'preview-host', ok: false, detail: 'certificate has expired' });
	});

	it('fails the apex check when the marketing site is no longer served by Vercel', async () => {
		const { impl } = fakeFetch({
			...healthy,
			'https://getestori.com/': () => new Response('x', { status: 200, headers: { server: 'cloudflare' } }),
		});
		expect((await runSmokeChecks(CONFIG, impl)).find((r) => r.name === 'marketing-apex')?.ok).toBe(false);
	});
});
