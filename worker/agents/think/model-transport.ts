/**
 * Fetch transport for the build model. It rewrites each body for its target
 * model, ends requests a provider never answers, and records provider failures
 * so the host can offer the user a switch.
 */

export type ProviderFailureReason = 'overloaded' | 'rate_limited' | 'unavailable' | 'timeout';

export interface ProviderFailure {
	/** Gateway model id from the request body. */
	modelId: string;
	reason: ProviderFailureReason;
	status?: number;
	/** The provider's own message, when it sent one. */
	detail?: string;
}

export interface ModelTransportOptions {
	/** How long to wait for response headers before treating the provider as failed. */
	timeoutMs: number;
	/** Rewrites each outgoing body for its target model. */
	prepareBody?: (body: string) => string;
	/** Called after every answered request: the failure, or null when the provider responded normally. */
	onProviderStatus?: (failure: ProviderFailure | null) => void;
	fetchImpl?: typeof fetch;
}

export function classifyProviderStatus(status: number): ProviderFailureReason | null {
	if (status === 429) return 'rate_limited';
	if (status === 503 || status === 529) return 'overloaded';
	if (status >= 500) return 'unavailable';
	return null;
}

export function createModelTransport(options: ModelTransportOptions): typeof fetch {
	const { timeoutMs, prepareBody, onProviderStatus } = options;
	const fetchImpl: typeof fetch = options.fetchImpl ?? ((input, init) => fetch(input, init));

	return async (input, init) => {
		const body = init?.body;
		const modelId = (typeof body === 'string' ? modelOf(body) : undefined) ?? 'unknown';
		const prepared: RequestInit = {
			...(init ?? {}),
			body: typeof body === 'string' && prepareBody ? prepareBody(body) : body,
		};

		const attempt = await fetchWithTimeout(fetchImpl, input, prepared, timeoutMs);
		if (attempt.kind === 'timeout') {
			onProviderStatus?.({ modelId, reason: 'timeout' });
			return Response.json(
				{ error: { message: `The model did not respond within ${Math.round(timeoutMs / 1000)} seconds` } },
				{ status: 504 },
			);
		}

		const reason = classifyProviderStatus(attempt.response.status);
		if (!reason) {
			onProviderStatus?.(null);
			return attempt.response;
		}
		const detail = await providerMessage(attempt.response.clone());
		onProviderStatus?.({ modelId, reason, status: attempt.response.status, ...(detail ? { detail } : {}) });
		return attempt.response;
	};
}

type Attempt = { kind: 'response'; response: Response } | { kind: 'timeout' };

/**
 * Runs the request, aborting it if no response headers arrive in time.
 * A caller abort is rethrown; only the timeout becomes a failure.
 */
async function fetchWithTimeout(
	fetchImpl: typeof fetch,
	input: RequestInfo | URL,
	init: RequestInit,
	timeoutMs: number,
): Promise<Attempt> {
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

function modelOf(body: string): string | undefined {
	try {
		const model = (JSON.parse(body) as { model?: unknown }).model;
		return typeof model === 'string' ? model : undefined;
	} catch {
		return undefined;
	}
}

/** The `error.message` a provider sent (Google wraps it in an array), shortened for display. */
async function providerMessage(response: Response): Promise<string | undefined> {
	let parsed: unknown;
	try {
		parsed = await response.json();
	} catch {
		return undefined;
	}
	const root: unknown = Array.isArray(parsed) ? parsed[0] : parsed;
	const message = (root as { error?: { message?: unknown } } | undefined)?.error?.message;
	return typeof message === 'string' ? message.slice(0, 300) : undefined;
}
