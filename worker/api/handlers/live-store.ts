/**
 * A live store on its own address: Estori's `/__estori/*` paths are answered here, and everything else is served by the
 * store's SpaceDO from the version the seller published, at the root.
 */

import { msg } from '../../../shared/i18n/translate';
import { LIVE_BRANCH, SPACE_LIVE_PATH } from '../../../shared/types/live-stores';
import type { StoreHost } from '../../services/live-stores/hosts';
import { createLogger } from '../../logger';
import { handleStorePlatform, matchLivePlatformPath } from './store-platform';
import { plainPage } from './plain-page';
import { serveStorePage, shopperLanguage } from '../../services/store-translations/serve-context';

const logger = createLogger('LiveStore');

const CLOSED_TITLE = msg("This store isn't open right now");
const CLOSED_MESSAGE = msg('Check back soon.');
const UNAVAILABLE_TITLE = msg('This store is temporarily unavailable');
const UNAVAILABLE_MESSAGE = msg('Try again in a moment.');
/** What a shopper who already paid still needs from a closed store: the return from Stripe, and their receipts. */
const AFTER_PAYMENT_PATH = /^\/__estori\/(return|orders\/)/;

export async function handleLiveStore(request: Request, env: Env, ctx: ExecutionContext, host: StoreHost): Promise<Response> {
	const { store } = host;
	const url = new URL(request.url);
	const platform = matchLivePlatformPath(url.pathname);
	const target = platform ? { appId: store.appId, branch: LIVE_BRANCH, ...platform, viewer: { kind: 'live' as const, sellerUserId: store.sellerUserId } } : null;
	if (store.status !== 'live') {
		if (target && AFTER_PAYMENT_PATH.test(target.platformPath)) return handleStorePlatform(request, env, { ...target, closed: true }, ctx);
		return plainPage((await shopperLanguage(request, env, store.appId)).locale, 404, CLOSED_TITLE, CLOSED_MESSAGE);
	}
	if (target) return handleStorePlatform(request, env, target, ctx);

	const namespace = (env as unknown as { SPACE_DO?: DurableObjectNamespace }).SPACE_DO;
	if (!namespace) return plainPage((await shopperLanguage(request, env, store.appId)).locale, 503, UNAVAILABLE_TITLE, UNAVAILABLE_MESSAGE);
	const forwarded = new URL(`${SPACE_LIVE_PATH}${url.pathname}${url.search}`, url.origin);
	const space = namespace.get(namespace.idFromName(store.appId));
	try {
		return await serveStorePage(request, env, ctx, { appId: store.appId, basePath: '', pageUrl: url }, (page) => space.fetch(new Request(forwarded.toString(), page)));
	} catch (error) {
		logger.error('Live store could not be served', { appId: store.appId, error });
		return plainPage((await shopperLanguage(request, env, store.appId)).locale, 503, UNAVAILABLE_TITLE, UNAVAILABLE_MESSAGE);
	}
}
