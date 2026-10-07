import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidecarCaptureClient } from './sidecar-client';
import { createLogger } from '../../logger';

const STOP = 'Stopped by the user';

afterEach(() => {
	vi.unstubAllGlobals();
});

/** A sidecar that is healthy but never finishes a capture until the request is aborted. */
function stubHangingSidecar(): { captureRequests: number } {
	const sidecar = { captureRequests: 0 };
	vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		if (String(input).endsWith('/health')) return Promise.resolve(new Response('ok'));
		sidecar.captureRequests++;
		return new Promise<Response>((_resolve, reject) => {
			init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
		});
	});
	return sidecar;
}

describe('SidecarCaptureClient', () => {
	it('reports a Stop instead of an unavailable sidecar', async () => {
		const sidecar = stubHangingSidecar();
		const client = new SidecarCaptureClient({} as Env, createLogger('SidecarCaptureTest'));
		const controller = new AbortController();
		const outcome: { value: unknown } = { value: 'running' };
		client
			.captureConsoleLogs(
				{ url: 'http://localhost:5173/preview', waitSeconds: 5, viewport: { width: 1280, height: 800 } },
				controller.signal,
			)
			.then(
				(result) => {
					outcome.value = result;
				},
				(reason: unknown) => {
					outcome.value = reason;
				},
			);
		await vi.waitFor(() => expect(sidecar.captureRequests).toBe(1));

		controller.abort(STOP);

		await vi.waitFor(() => expect(outcome.value).toBe(STOP));
	});
});
