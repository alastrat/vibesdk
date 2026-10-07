/**
 * Request cancellation for the dev browser sidecar. The worker aborts its
 * capture request when the user presses Stop (or its own timeout fires), which
 * closes the connection before the sidecar has answered.
 */

/** The part of `http.ServerResponse` this needs. */
export interface ClosableResponse {
	readonly writableFinished: boolean;
	once(event: 'close', listener: () => void): unknown;
}

/**
 * A signal that aborts when the connection closes before the response was
 * sent. `close` also fires after a normal response, once `writableFinished`
 * is true, so only an early close counts.
 */
export function abortWhenClientLeaves(res: ClosableResponse): AbortSignal {
	const controller = new AbortController();
	res.once('close', () => {
		if (!res.writableFinished) controller.abort();
	});
	return controller.signal;
}
