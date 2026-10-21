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

/**
 * Keeps work running after the response. Never throws and never rejects: when waitUntil refuses the work, as after the
 * response, the work still runs, just without being kept alive.
 */
export function keepAlive(work: Promise<unknown>): void {
	const settled = work.then(
		() => undefined,
		() => undefined,
	);
	try {
		scope.getStore()?.(settled);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		console.warn(JSON.stringify({ level: 'warn', component: 'PostHog', msg: 'waitUntil refused work; it runs without being kept alive', error: reason }));
	}
}
