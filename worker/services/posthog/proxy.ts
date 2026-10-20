/**
 * Estori's own route to PostHog for the browser: /ingest/* on estori.app. Scripts and remote config come from
 * PostHog's asset host, everything else from its ingest host. posthog-js, bundled from npm, lazy-loads recorder.js
 * and its exception script from `<api_host>/static`, so they come through here too and the CSP needs no PostHog
 * host. Only a short list of headers goes out, so no session cookie, Authorization header or staging key reaches
 * PostHog, and no cookie comes back. The Referer is cut to its path: pages like /reset-password carry a token in
 * their query string, and tokens never leave the browser for PostHog.
 */

import { INGEST_PATH, POSTHOG_ASSET_HOST, POSTHOG_INGEST_HOST, posthogConfig } from './config';

const ASSET_PATHS = ['/static/', '/array/'] as const;
const FORWARDED_HEADERS = ['accept', 'accept-encoding', 'accept-language', 'content-encoding', 'content-type', 'origin', 'user-agent'] as const;
const ALLOWED_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'POST', 'OPTIONS']);
/** Versioned scripts only: remote config under /array/ must follow setting changes. */
const STATIC_CACHE_SECONDS = 3600;

export function isIngestPath(pathname: string): boolean {
	return pathname === INGEST_PATH || pathname.startsWith(`${INGEST_PATH}/`);
}

/** PostHog's URL for an /ingest request. The host is fixed; setting a URL's pathname can never change its host. */
export function ingestTarget(url: URL): URL {
	const path = url.pathname.slice(INGEST_PATH.length) || '/';
	const host = ASSET_PATHS.some((prefix) => path.startsWith(prefix)) ? POSTHOG_ASSET_HOST : POSTHOG_INGEST_HOST;
	const target = new URL(`https://${host}/`);
	target.pathname = path;
	target.search = url.search;
	return target;
}

/** The referring page's address without query, fragment or credentials; null when it can't be parsed. */
function referrerPath(referer: string): string | null {
	try {
		const url = new URL(referer);
		url.search = '';
		url.hash = '';
		url.username = '';
		url.password = '';
		return url.toString();
	} catch {
		return null;
	}
}

export async function proxyPostHog(request: Request, env: Env, fetcher: typeof fetch = (input, init) => fetch(input, init)): Promise<Response> {
	if (!posthogConfig(env)) return new Response('Not found', { status: 404 });
	if (!ALLOWED_METHODS.has(request.method)) return new Response('Method not allowed', { status: 405 });
	const target = ingestTarget(new URL(request.url));
	const headers = new Headers();
	for (const name of FORWARDED_HEADERS) {
		const value = request.headers.get(name);
		if (value !== null) headers.set(name, value);
	}
	const referer = request.headers.get('referer');
	const safeReferer = referer === null ? null : referrerPath(referer);
	if (safeReferer) headers.set('referer', safeReferer);
	const ip = request.headers.get('CF-Connecting-IP');
	if (ip) headers.set('X-Forwarded-For', ip);
	const cacheable = request.method === 'GET' && target.pathname.startsWith('/static/');
	const upstream = await fetcher(target.toString(), {
		method: request.method,
		headers,
		body: request.method === 'POST' ? request.body : undefined,
		redirect: 'manual',
		...(cacheable ? { cf: { cacheEverything: true, cacheTtl: STATIC_CACHE_SECONDS } } : {}),
	});
	const responseHeaders = new Headers(upstream.headers);
	responseHeaders.delete('set-cookie');
	return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
}
