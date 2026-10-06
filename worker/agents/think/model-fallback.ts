/**
 * Fetch wrapper that re-sends a chat-completions request to a second model on
 * the same AI Gateway when the primary provider is overloaded or unresponsive.
 */

/** Statuses that mean the primary provider is overloaded or failing, not that the request is wrong. */
const FALLBACK_STATUSES = new Set([429, 500, 502, 503, 504]);

export interface ModelFallback {
	/** Gateway model id, for example `anthropic/claude-opus-5-5`. */
	modelName: string;
	/** Provider key sent as the `Authorization` bearer token; omitted when the gateway holds the key (BYOK). */
	apiKey?: string;
	/** Extra headers for the fallback request, such as `cf-aig-authorization`. */
	headers?: Record<string, string>;
}

export interface FallbackFetchOptions {
	fallback?: ModelFallback;
	/** How long to wait for the primary provider's response headers before falling back. */
	primaryTimeoutMs: number;
	/** Rewrites the body of the primary request only, for provider-specific fields. */
	preparePrimaryBody?: (body: string) => string;
	onFallback?: (reason: string) => void;
	fetchImpl?: typeof fetch;
}

export function createFallbackFetch(options: FallbackFetchOptions): typeof fetch {
	const { fallback, primaryTimeoutMs, preparePrimaryBody, onFallback } = options;
	const fetchImpl: typeof fetch = options.fetchImpl ?? ((input, init) => fetch(input, init));

	return async (input, init) => {
		const body = init?.body;
		const primaryBody = typeof body === 'string' && preparePrimaryBody ? preparePrimaryBody(body) : body;
		const primaryInit: RequestInit = { ...(init ?? {}), body: primaryBody };
		const fallbackBody = typeof body === 'string' && fallback ? withModel(body, fallback.modelName) : null;

		if (!fallback || fallbackBody === null) {
			return fetchImpl(input, primaryInit);
		}

		const attempt = await fetchWithTimeout(fetchImpl, input, primaryInit, primaryTimeoutMs);
		if (attempt.kind === 'response' && !FALLBACK_STATUSES.has(attempt.response.status)) {
			return attempt.response;
		}
		if (attempt.kind === 'response') {
			await attempt.response.body?.cancel();
		}
		onFallback?.(attempt.kind === 'response' ? `status ${attempt.response.status}` : 'timeout');

		const headers = new Headers(init?.headers);
		if (fallback.apiKey) {
			headers.set('authorization', `Bearer ${fallback.apiKey}`);
		} else {
			headers.delete('authorization');
		}
		for (const [name, value] of Object.entries(fallback.headers ?? {})) {
			headers.set(name, value);
		}
		return fetchImpl(input, { ...(init ?? {}), headers, body: fallbackBody });
	};
}

type PrimaryAttempt = { kind: 'response'; response: Response } | { kind: 'timeout' };

/**
 * Runs the primary request, aborting it if no response headers arrive in time.
 * A caller abort is rethrown; only the timeout is turned into a fallback signal.
 */
async function fetchWithTimeout(
	fetchImpl: typeof fetch,
	input: RequestInfo | URL,
	init: RequestInit,
	timeoutMs: number,
): Promise<PrimaryAttempt> {
	const controller = new AbortController();
	const callerSignal = init.signal;
	const forwardAbort = () => controller.abort(callerSignal?.reason);
	if (callerSignal?.aborted) forwardAbort();
	callerSignal?.addEventListener('abort', forwardAbort, { once: true });

	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, timeoutMs);

	try {
		const response = await fetchImpl(input, { ...init, signal: controller.signal });
		return { kind: 'response', response };
	} catch (error) {
		if (timedOut && !callerSignal?.aborted) return { kind: 'timeout' };
		throw error;
	} finally {
		// The abort forwarding stays attached: it must keep cancelling the response stream.
		clearTimeout(timer);
	}
}

/** Returns the JSON body with its `model` replaced, or null when the body is not a JSON object. */
function withModel(body: string, modelName: string): string | null {
	try {
		const json: unknown = JSON.parse(body);
		if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
		return JSON.stringify({ ...json, model: modelName });
	} catch {
		return null;
	}
}
