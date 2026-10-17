/**
 * A live store on its own address: Estori's `/__estori/*` paths are answered here, and everything else is served by the
 * store's SpaceDO from the version the seller published, at the root.
 */

import { LIVE_BRANCH, SPACE_LIVE_PATH } from '../../../shared/types/live-stores';
import type { StoreHost } from '../../services/live-stores/hosts';
import { createLogger } from '../../logger';
import { handleStorePlatform, matchLivePlatformPath } from './store-platform';

const logger = createLogger('LiveStore');

function page(status: number, title: string, message: string): Response {
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f6f4;color:#1c1c1c;font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px}main{max-width:420px;text-align:center}h1{font-size:24px;margin:0 0 8px}p{margin:0;color:#5c5c5c}</style>
</head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
	return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function handleLiveStore(request: Request, env: Env, ctx: ExecutionContext, host: StoreHost): Promise<Response> {
	const { store } = host;
	if (store.status !== 'live') return page(404, "This store isn't open right now", 'Check back soon.');

	const url = new URL(request.url);
	const platform = matchLivePlatformPath(url.pathname);
	if (platform) {
		return handleStorePlatform(request, env, { appId: store.appId, branch: LIVE_BRANCH, ...platform, viewer: { kind: 'live', sellerUserId: store.sellerUserId } }, ctx);
	}

	const namespace = (env as unknown as { SPACE_DO?: DurableObjectNamespace }).SPACE_DO;
	if (!namespace) return page(503, 'This store is temporarily unavailable', 'Try again in a moment.');
	const forwarded = new URL(`${SPACE_LIVE_PATH}${url.pathname}${url.search}`, url.origin);
	try {
		return await namespace.get(namespace.idFromName(store.appId)).fetch(new Request(forwarded.toString(), request));
	} catch (error) {
		logger.error('Live store could not be served', { appId: store.appId, error });
		return page(503, 'This store is temporarily unavailable', 'Try again in a moment.');
	}
}
