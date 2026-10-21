import { describe, expect, it, vi } from 'vitest';
import { UPSTREAM_TIMEOUT_MS, ingestTarget, isIngestPath, proxyPostHog } from './proxy';

const ENV = { POSTHOG_PROJECT_KEY: 'phc_test', ENVIRONMENT: 'prod' } as unknown as Env;

function recorder(upstream = () => new Response('ok', { status: 200, headers: { 'Set-Cookie': 'ph=1', 'Content-Type': 'text/plain' } })) {
	const calls: Array<{ url: string; init: RequestInit<RequestInitCfProperties> }> = [];
	const fetcher: typeof fetch = async (input, init) => {
		calls.push({ url: String(input), init: init ?? {} });
		return upstream();
	};
	return { calls, fetcher };
}

const at = (path: string, init?: RequestInit) => new Request(`https://estori.app${path}`, init);

describe('the /ingest proxy', () => {
	it('sends events to the ingest host and scripts and config to the asset host, keeping the query', () => {
		expect(ingestTarget(new URL('https://estori.app/ingest/e/?ip=1&ver=1.2')).toString()).toBe('https://us.i.posthog.com/e/?ip=1&ver=1.2');
		expect(ingestTarget(new URL('https://estori.app/ingest/static/recorder.js?v=1')).toString()).toBe('https://us-assets.i.posthog.com/static/recorder.js?v=1');
		expect(ingestTarget(new URL('https://estori.app/ingest/array/phc_test/config.js')).toString()).toBe('https://us-assets.i.posthog.com/array/phc_test/config.js');
		expect(ingestTarget(new URL('https://estori.app/ingest')).toString()).toBe('https://us.i.posthog.com/');
	});

	it('never leaves PostHog, whatever the path says', () => {
		for (const path of ['/ingest//attacker.example/collect', '/ingest/%2F%2Fattacker.example/x', '/ingest/@attacker.example/x', '/ingest/..%2F..%2Fapi/auth/profile']) {
			expect(ingestTarget(new URL(`https://estori.app${path}`)).hostname, path).toBe('us.i.posthog.com');
		}
	});

	it('matches /ingest and below only', () => {
		expect(isIngestPath('/ingest')).toBe(true);
		expect(isIngestPath('/ingest/e/')).toBe(true);
		expect(isIngestPath('/ingestion')).toBe(false);
		expect(isIngestPath('/api/ingest')).toBe(false);
	});

	it('forwards the body, safe headers and the client IP, and never cookies, Authorization or the staging key', async () => {
		const { calls, fetcher } = recorder();
		await proxyPostHog(
			at('/ingest/e/?compression=gzip-js', {
				method: 'POST',
				body: 'payload',
				headers: {
					'Content-Type': 'text/plain',
					'User-Agent': 'Browser/1.0',
					Cookie: 'accessToken=secret; estori_staging=digest',
					Authorization: 'Bearer secret',
					'x-estori-staging-key': 'staging-secret',
					'CF-Connecting-IP': '203.0.113.9',
				},
			}),
			ENV,
			fetcher,
		);
		const sent = new Headers(calls[0].init.headers);
		expect(calls[0].url).toBe('https://us.i.posthog.com/e/?compression=gzip-js');
		expect(calls[0].init.method).toBe('POST');
		expect(sent.get('content-type')).toBe('text/plain');
		expect(sent.get('user-agent')).toBe('Browser/1.0');
		expect(sent.get('x-forwarded-for')).toBe('203.0.113.9');
		for (const name of ['cookie', 'authorization', 'x-estori-staging-key', 'cf-connecting-ip']) expect(sent.has(name), name).toBe(false);
		expect(await new Response(calls[0].init.body).text()).toBe('payload');
	});

	it('forwards the referring page without its query string or fragment, so a reset token never reaches PostHog', async () => {
		const { calls, fetcher } = recorder();
		await proxyPostHog(
			at('/ingest/e/', {
				method: 'POST',
				body: '{}',
				headers: { Referer: 'https://estori.app/reset-password?token=secret#x', Origin: 'https://estori.app' },
			}),
			ENV,
			fetcher,
		);
		const sent = new Headers(calls[0].init.headers);
		expect(sent.get('referer')).toBe('https://estori.app/reset-password');
		expect(sent.get('origin')).toBe('https://estori.app');
		expect(JSON.stringify([...sent.entries()])).not.toContain('token');
		expect(calls[0].url).not.toContain('token');
	});

	it('drops a Referer it cannot parse rather than forwarding it as it came', async () => {
		const { calls, fetcher } = recorder();
		const request = at('/ingest/e/', { method: 'POST', body: '{}' });
		request.headers.set('Referer', 'not a url?token=secret');
		await proxyPostHog(request, ENV, fetcher);
		const sent = new Headers(calls[0].init.headers);
		expect(sent.has('referer')).toBe(false);
	});

	it('takes no cookie back from PostHog', async () => {
		const { fetcher } = recorder();
		const response = await proxyPostHog(at('/ingest/flags/?v=2', { method: 'POST', body: '{}' }), ENV, fetcher);
		expect(response.status).toBe(200);
		expect(response.headers.get('set-cookie')).toBeNull();
		expect(response.headers.get('content-type')).toBe('text/plain');
	});

	it('caches versioned scripts but not remote config or events', async () => {
		const { calls, fetcher } = recorder();
		await proxyPostHog(at('/ingest/static/recorder.js?v=1'), ENV, fetcher);
		await proxyPostHog(at('/ingest/array/phc_test/config.js'), ENV, fetcher);
		await proxyPostHog(at('/ingest/e/', { method: 'POST', body: '{}' }), ENV, fetcher);
		expect(calls.map((call) => call.init.cf ?? null)).toEqual([{ cacheEverything: true, cacheTtl: 3600 }, null, null]);
	});

	it('answers 404 without a project key and 405 for other methods, calling nobody', async () => {
		const { calls, fetcher } = recorder();
		expect((await proxyPostHog(at('/ingest/e/', { method: 'POST', body: '{}' }), { ENVIRONMENT: 'prod' } as unknown as Env, fetcher)).status).toBe(404);
		expect((await proxyPostHog(at('/ingest/e/', { method: 'DELETE' }), ENV, fetcher)).status).toBe(405);
		expect(calls).toEqual([]);
	});

	it('answers 502 with one warning, not an error, when PostHog cannot be reached', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const fetcher: typeof fetch = async () => {
				throw new TypeError('Network connection lost');
			};
			const response = await proxyPostHog(at('/ingest/e/', { method: 'POST', body: '{}' }), ENV, fetcher);
			expect(response.status).toBe(502);
			expect(await response.text()).toBe('Bad gateway');
			expect(warn).toHaveBeenCalledTimes(1);
			expect(error).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
			error.mockRestore();
		}
	});

	it('gives the upstream call a timeout signal that fires after ten seconds', async () => {
		const { calls, fetcher } = recorder();
		await proxyPostHog(at('/ingest/e/', { method: 'POST', body: '{}' }), ENV, fetcher);
		const signal = calls[0].init.signal;
		expect(UPSTREAM_TIMEOUT_MS).toBe(10_000);
		expect(signal).toBeInstanceOf(AbortSignal);
		expect(signal?.aborted).toBe(false);
	});

	it('answers 502 when the upstream call times out', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const fetcher: typeof fetch = async (_input, init) => {
				throw init?.signal?.reason ?? new Error('no signal');
			};
			const timeout = new DOMException('The operation timed out', 'TimeoutError');
			const spy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(timeout));
			try {
				const response = await proxyPostHog(at('/ingest/e/', { method: 'POST', body: '{}' }), ENV, fetcher);
				expect(spy).toHaveBeenCalledWith(10_000);
				expect(response.status).toBe(502);
			} finally {
				spy.mockRestore();
			}
		} finally {
			warn.mockRestore();
		}
	});
});
