import { describe, expect, it } from 'vitest';
import { createFallbackFetch, FallbackLatch, type ModelFallback } from './model-fallback';

const URL = 'https://gateway.ai.cloudflare.com/v1/acct/estori-gateway/compat/chat/completions';

const FALLBACK: ModelFallback = {
	modelName: 'anthropic/claude-opus-5-5',
	apiKey: 'anthropic-key',
	headers: { 'cf-aig-authorization': 'Bearer gateway-token' },
};

interface SeenRequest {
	body: { model?: string; messages?: unknown };
	headers: Headers;
}

/** Fake fetch that answers each call with the next queued responder. */
function fakeFetch(responders: Array<(init?: RequestInit) => Response | Promise<Response>>) {
	const seen: SeenRequest[] = [];
	const impl = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		seen.push({ body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
		const next = responders.shift();
		if (!next) throw new Error('unexpected fetch');
		return next(init);
	};
	return { impl: impl as typeof fetch, seen };
}

function primaryInit(): RequestInit {
	return {
		method: 'POST',
		headers: {
			authorization: 'Bearer google-key',
			'cf-aig-authorization': 'Bearer gateway-token',
			'content-type': 'application/json',
		},
		body: JSON.stringify({ model: 'google-ai-studio/gemini-3.6-flash', messages: [{ role: 'user', content: 'hi' }] }),
	};
}

/** Never resolves until the request's signal aborts, like a provider that hangs. */
function hang(init?: RequestInit): Promise<Response> {
	return new Promise((_resolve, reject) => {
		init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
	});
}

describe('createFallbackFetch', () => {
	it('returns the primary response when it succeeds', async () => {
		const { impl, seen } = fakeFetch([() => new Response('primary', { status: 200 })]);
		const res = await createFallbackFetch({ fallback: FALLBACK, primaryTimeoutMs: 1000, fetchImpl: impl })(URL, primaryInit());
		expect(await res.text()).toBe('primary');
		expect(seen).toHaveLength(1);
	});

	it.each([429, 500, 502, 503, 504])('falls back when the primary answers %i', async (status) => {
		const { impl, seen } = fakeFetch([
			() => new Response('overloaded', { status }),
			() => new Response('fallback', { status: 200 }),
		]);
		const res = await createFallbackFetch({ fallback: FALLBACK, primaryTimeoutMs: 1000, fetchImpl: impl })(URL, primaryInit());
		expect(await res.text()).toBe('fallback');
		expect(seen.map((s) => s.body.model)).toEqual(['google-ai-studio/gemini-3.6-flash', 'anthropic/claude-opus-5-5']);
	});

	it('passes client errors through without falling back', async () => {
		const { impl, seen } = fakeFetch([() => new Response('bad request', { status: 400 })]);
		const res = await createFallbackFetch({ fallback: FALLBACK, primaryTimeoutMs: 1000, fetchImpl: impl })(URL, primaryInit());
		expect(res.status).toBe(400);
		expect(seen).toHaveLength(1);
	});

	it('falls back when the primary sends no response within the timeout', async () => {
		const { impl, seen } = fakeFetch([hang, () => new Response('fallback', { status: 200 })]);
		const res = await createFallbackFetch({ fallback: FALLBACK, primaryTimeoutMs: 20, fetchImpl: impl })(URL, primaryInit());
		expect(await res.text()).toBe('fallback');
		expect(seen).toHaveLength(2);
	});

	it('sends the fallback provider key and keeps the gateway authorization', async () => {
		const { impl, seen } = fakeFetch([
			() => new Response('overloaded', { status: 503 }),
			() => new Response('fallback', { status: 200 }),
		]);
		await createFallbackFetch({ fallback: FALLBACK, primaryTimeoutMs: 1000, fetchImpl: impl })(URL, primaryInit());
		expect(seen[1].headers.get('authorization')).toBe('Bearer anthropic-key');
		expect(seen[1].headers.get('cf-aig-authorization')).toBe('Bearer gateway-token');
		expect(seen[1].headers.get('content-type')).toBe('application/json');
	});

	it('relies on the gateway stored key when the fallback has no provider key', async () => {
		const { impl, seen } = fakeFetch([
			() => new Response('overloaded', { status: 503 }),
			() => new Response('fallback', { status: 200 }),
		]);
		const storedKeyFallback: ModelFallback = { modelName: FALLBACK.modelName, headers: FALLBACK.headers };
		await createFallbackFetch({ fallback: storedKeyFallback, primaryTimeoutMs: 1000, fetchImpl: impl })(URL, primaryInit());
		expect(seen[1].headers.get('authorization')).toBeNull();
		expect(seen[1].headers.get('cf-aig-authorization')).toBe('Bearer gateway-token');
	});

	it('applies primary-only body changes to the primary request but not to the fallback', async () => {
		const { impl, seen } = fakeFetch([
			() => new Response('overloaded', { status: 503 }),
			() => new Response('fallback', { status: 200 }),
		]);
		const preparePrimaryBody = (body: string) => {
			const json = JSON.parse(body) as Record<string, unknown>;
			return JSON.stringify({ ...json, extra_content: { google: { thought_signature: 'sig' } } });
		};
		await createFallbackFetch({ fallback: FALLBACK, primaryTimeoutMs: 1000, preparePrimaryBody, fetchImpl: impl })(URL, primaryInit());
		expect(seen[0].body).toHaveProperty('extra_content');
		expect(seen[1].body).not.toHaveProperty('extra_content');
		expect(seen[1].body.messages).toEqual([{ role: 'user', content: 'hi' }]);
	});

	it('returns the fallback error so the caller can retry when both providers fail', async () => {
		const { impl } = fakeFetch([
			() => new Response('overloaded', { status: 503 }),
			() => new Response('also overloaded', { status: 529 }),
		]);
		const res = await createFallbackFetch({ fallback: FALLBACK, primaryTimeoutMs: 1000, fetchImpl: impl })(URL, primaryInit());
		expect(res.status).toBe(529);
	});

	it('changes nothing about the request when no fallback is configured', async () => {
		const { impl, seen } = fakeFetch([() => new Response('overloaded', { status: 503 })]);
		const preparePrimaryBody = (body: string) => body.replace('"hi"', '"hello"');
		const res = await createFallbackFetch({ primaryTimeoutMs: 1000, preparePrimaryBody, fetchImpl: impl })(URL, primaryInit());
		expect(res.status).toBe(503);
		expect(seen).toHaveLength(1);
		expect(seen[0].body.messages).toEqual([{ role: 'user', content: 'hello' }]);
		expect(seen[0].headers.get('authorization')).toBe('Bearer google-key');
	});

	it('does not fall back when the caller aborts the request', async () => {
		const { impl, seen } = fakeFetch([hang]);
		const controller = new AbortController();
		const pending = createFallbackFetch({ fallback: FALLBACK, primaryTimeoutMs: 1000, fetchImpl: impl })(URL, {
			...primaryInit(),
			signal: controller.signal,
		});
		controller.abort();
		await expect(pending).rejects.toThrow();
		expect(seen).toHaveLength(1);
	});

	it('sends later requests straight to the fallback once the primary has failed', async () => {
		const latch = new FallbackLatch();
		const { impl, seen } = fakeFetch([
			() => new Response('overloaded', { status: 503 }),
			() => new Response('fallback 1', { status: 200 }),
			() => new Response('fallback 2', { status: 200 }),
		]);
		const transport = createFallbackFetch({ fallback: FALLBACK, primaryTimeoutMs: 1000, latch, fetchImpl: impl });
		await transport(URL, primaryInit());
		const second = await transport(URL, primaryInit());
		expect(await second.text()).toBe('fallback 2');
		expect(seen.map((s) => s.body.model)).toEqual([
			'google-ai-studio/gemini-3.6-flash',
			'anthropic/claude-opus-5-5',
			'anthropic/claude-opus-5-5',
		]);
		expect(seen[2].headers.get('authorization')).toBe('Bearer anthropic-key');
	});

	it('tries the primary again after the latch is reset', async () => {
		const latch = new FallbackLatch();
		const { impl, seen } = fakeFetch([
			() => new Response('overloaded', { status: 503 }),
			() => new Response('fallback', { status: 200 }),
			() => new Response('primary', { status: 200 }),
		]);
		const transport = createFallbackFetch({ fallback: FALLBACK, primaryTimeoutMs: 1000, latch, fetchImpl: impl });
		await transport(URL, primaryInit());
		latch.reset();
		const res = await transport(URL, primaryInit());
		expect(await res.text()).toBe('primary');
		expect(seen[2].body.model).toBe('google-ai-studio/gemini-3.6-flash');
	});

	it('does not engage the latch when the primary succeeds', async () => {
		const latch = new FallbackLatch();
		const { impl } = fakeFetch([() => new Response('primary', { status: 200 })]);
		await createFallbackFetch({ fallback: FALLBACK, primaryTimeoutMs: 1000, latch, fetchImpl: impl })(URL, primaryInit());
		expect(latch.isEngaged()).toBe(false);
	});

	it('reports why it fell back', async () => {
		const reasons: string[] = [];
		const { impl } = fakeFetch([
			() => new Response('overloaded', { status: 503 }),
			() => new Response('fallback', { status: 200 }),
		]);
		await createFallbackFetch({ fallback: FALLBACK, primaryTimeoutMs: 1000, fetchImpl: impl, onFallback: (r) => reasons.push(r) })(URL, primaryInit());
		expect(reasons).toEqual(['status 503']);
	});
});
