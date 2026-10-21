/**
 * The request a piece of work belongs to, so analytics can send after the response through that request's
 * `waitUntil`. Durable Objects have no request scope; there the work runs on its own, since an object stays alive
 * while it has pending work. Never imports the logger: the logger's error path uses this.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Locale } from '../../../shared/i18n/locales';

type WaitUntil = (work: Promise<unknown>) => void;

interface RequestScope { waitUntil: WaitUntil | null; locale: Locale }
const scope = new AsyncLocalStorage<RequestScope>();

export function runWithLocale<T>(locale: Locale, run: () => T): T {
	return scope.run({ waitUntil: scope.getStore()?.waitUntil ?? null, locale }, run);
}

export function currentLocale(): Locale { return scope.getStore()?.locale ?? 'en'; }

/** Authentication refines the browser fallback only inside this request. */
export function setRequestLocale(locale: Locale): void {
	const active = scope.getStore();
	if (active) active.locale = locale;
}

export function runInRequestScope<T>(ctx: { waitUntil?: WaitUntil } | undefined, run: () => T): T {
	// Bound: workerd refuses an unbound waitUntil. Tests pass {} as the context, which has none.
	const waitUntil = typeof ctx?.waitUntil === 'function' ? ctx.waitUntil.bind(ctx) : null;
	return scope.run({ waitUntil, locale: scope.getStore()?.locale ?? 'en' }, run);
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
		scope.getStore()?.waitUntil?.(settled);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		console.warn(JSON.stringify({ level: 'warn', component: 'PostHog', msg: 'waitUntil refused work; it runs without being kept alive', error: reason }));
	}
}
