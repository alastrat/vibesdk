import { describe, expect, it } from 'vitest';
import { classifyProviderStatus, createModelTransport, type ProviderFailure } from './model-transport';

const URL = 'https://gateway.ai.cloudflare.com/v1/acct/estori-gateway/compat/chat/completions';

function init(model = 'google-ai-studio/gemini-3.6-flash'): RequestInit {
	return {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }] }),
	};
}

function recorder() {
	const statuses: Array<ProviderFailure | null> = [];
	return { statuses, onProviderStatus: (failure: ProviderFailure | null) => statuses.push(failure) };
}

/** Never resolves until the request's signal aborts, like a provider that hangs. */
function hang(_input: RequestInfo | URL, request?: RequestInit): Promise<Response> {
	return new Promise((_resolve, reject) => {
		request?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
	});
}

describe('classifyProviderStatus', () => {
	it.each([
		[429, 'rate_limited'],
		[503, 'overloaded'],
		[529, 'overloaded'],
		[500, 'unavailable'],
		[502, 'unavailable'],
		[504, 'unavailable'],
		[400, null],
		[200, null],
	])('maps %i to %s', (status, reason) => {
		expect(classifyProviderStatus(status)).toBe(reason);
	});
});

describe('createModelTransport', () => {
	it('passes a successful response through and clears the failure record', async () => {
		const { statuses, onProviderStatus } = recorder();
		const transport = createModelTransport({ timeoutMs: 1000, onProviderStatus, fetchImpl: async () => new Response('ok') });
		const res = await transport(URL, init());
		expect(await res.text()).toBe('ok');
		expect(statuses).toEqual([null]);
	});

	it('runs the body hook on the outgoing body', async () => {
		let sent = '';
		const transport = createModelTransport({
			timeoutMs: 1000,
			prepareBody: (body) => body.replace('"hi"', '"hello"'),
			fetchImpl: async (_input, request) => {
				sent = String(request?.body);
				return new Response('ok');
			},
		});
		await transport(URL, init());
		expect(JSON.parse(sent).messages[0].content).toBe('hello');
	});

	it('awaits an async body hook before sending', async () => {
		let sent = '';
		const transport = createModelTransport({
			timeoutMs: 1000,
			prepareBody: async (body) => {
				await Promise.resolve();
				return body.replace('"hi"', '"inlined"');
			},
			fetchImpl: async (_input, request) => {
				sent = String(request?.body);
				return new Response('ok');
			},
		});
		await transport(URL, init());
		expect(JSON.parse(sent).messages[0].content).toBe('inlined');
	});

	it('records an overloaded provider with its own message and returns the response for retrying', async () => {
		const { statuses, onProviderStatus } = recorder();
		const googleError = JSON.stringify([{ error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } }]);
		const transport = createModelTransport({
			timeoutMs: 1000,
			onProviderStatus,
			fetchImpl: async () => new Response(googleError, { status: 503 }),
		});
		const res = await transport(URL, init());
		expect(res.status).toBe(503);
		expect(await res.text()).toBe(googleError);
		expect(statuses).toEqual([
			{ modelId: 'google-ai-studio/gemini-3.6-flash', reason: 'overloaded', status: 503, detail: 'This model is currently experiencing high demand.' },
		]);
	});

	it('reads the message from an Anthropic-style error body', async () => {
		const { statuses, onProviderStatus } = recorder();
		const transport = createModelTransport({
			timeoutMs: 1000,
			onProviderStatus,
			fetchImpl: async () => Response.json({ error: { type: 'overloaded_error', message: 'Overloaded' } }, { status: 529 }),
		});
		await transport(URL, init('anthropic/claude-sonnet-5-5'));
		expect(statuses).toEqual([{ modelId: 'anthropic/claude-sonnet-5-5', reason: 'overloaded', status: 529, detail: 'Overloaded' }]);
	});

	it('does not treat a bad request as a provider failure', async () => {
		const { statuses, onProviderStatus } = recorder();
		const transport = createModelTransport({ timeoutMs: 1000, onProviderStatus, fetchImpl: async () => new Response('bad', { status: 400 }) });
		const res = await transport(URL, init());
		expect(res.status).toBe(400);
		expect(statuses).toEqual([null]);
	});

	it('turns a provider that never answers into a retryable 504', async () => {
		const { statuses, onProviderStatus } = recorder();
		const transport = createModelTransport({ timeoutMs: 20, onProviderStatus, fetchImpl: hang });
		const res = await transport(URL, init());
		expect(res.status).toBe(504);
		expect(statuses).toEqual([{ modelId: 'google-ai-studio/gemini-3.6-flash', reason: 'timeout' }]);
	});

	it('rethrows a caller abort without recording a failure', async () => {
		const { statuses, onProviderStatus } = recorder();
		const controller = new AbortController();
		const pending = createModelTransport({ timeoutMs: 1000, onProviderStatus, fetchImpl: hang })(URL, { ...init(), signal: controller.signal });
		controller.abort();
		await expect(pending).rejects.toThrow();
		expect(statuses).toEqual([]);
	});
});
