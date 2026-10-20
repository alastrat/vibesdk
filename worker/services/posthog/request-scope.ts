/**
 * The request a piece of work belongs to, so analytics can send after the response through that request's
 * `waitUntil`. Durable Objects have no request scope; there the work runs on its own, since an object stays alive
 * while it has pending work. Never imports the logger: the logger's error path uses this.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

type WaitUntil = (work: Promise<unknown>) => void;

const scope = new AsyncLocalStorage<WaitUntil>();

export function runInRequestScope<T>(ctx: { waitUntil?: WaitUntil } | undefined, run: () => T): T {
	// Bound: workerd refuses an unbound waitUntil. Tests pass {} as the context, which has none.
	const waitUntil = typeof ctx?.waitUntil === 'function' ? ctx.waitUntil.bind(ctx) : null;
	return waitUntil ? scope.run(waitUntil, run) : run();
}

/** Keeps work running after the response. Never rejects, so a failure can't surface as an unhandled rejection. */
export function keepAlive(work: Promise<unknown>): void {
	const settled = work.then(
		() => undefined,
		() => undefined,
	);
	scope.getStore()?.(settled);
}
