import { msg } from '../../../../shared/i18n/translate';
import type { StoreWorkspaceProducts } from '../../../../shared/types/store-workspace';
import { AppService } from '../../../database/services/AppService';
import { LiveStoreService } from '../../../database/services/LiveStoreService';
import { storeHostConfig } from '../../../services/live-stores/hosts';
import { devPortOf, storeUrl } from '../../../services/live-stores/view';
import { parseStoreManifest } from '../../../services/store-payments/manifest';
import type { RouteContext } from '../../types/route-context';
import { BaseController } from '../baseController';
import type { ApiResponse, ControllerResponse } from '../types';
import { productView } from './products-view';

/** Same SpaceDO read RPC used by publishing; the package's public class type does not list RPC methods. */
interface ManifestSpace {
	getStoreManifest(branch: string): Promise<{ commitHash: string; manifest: string | null } | null>;
}

export class StoreWorkspaceController extends BaseController {
	static async products(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<StoreWorkspaceProducts>>> {
		if (!context.user || context.user.isAnonymous) return this.createErrorResponse(msg('Sign in to manage your store'), 401);
		const appId = context.pathParams.id;
		if (!appId) return this.createErrorResponse(msg('Store not found'), 404);
		try {
			const ownership = await new AppService(env).checkAppOwnership(appId, context.user.id);
			if (!ownership.isOwner) return this.createErrorResponse(msg('You can only access your own resources'), 403);
			const record = await new LiveStoreService(env).getByApp(appId);
			const host = storeHostConfig(env);
			const url = record?.status === 'live' && host.storesDomain
				? storeUrl(`${record.slug}.${host.storesDomain}`, devPortOf(env.CUSTOM_DOMAIN))
				: null;
			const data: StoreWorkspaceProducts = {
				appId, source: 'published', status: record?.status ?? 'unpublished',
				manifestStatus: 'unpublished', publishedAt: record?.publishedAt.toISOString() ?? null,
				publishedCommit: record?.publishedCommit ?? null, storeUrl: url, currency: 'usd', products: [],
			};
			if (record) {
				if (!env.SPACE_DO) return this.unavailable();
				const space = env.SPACE_DO.get(env.SPACE_DO.idFromName(appId)) as unknown as ManifestSpace;
				const published = await space.getStoreManifest('live');
				// A publish moves the deployment and its record separately. Retry instead of attaching stale provenance.
				if (!published || published.commitHash !== record.publishedCommit) return this.unavailable();
				const parsed = published.manifest === null ? null : parseStoreManifest(published.manifest);
				data.manifestStatus = parsed === null ? 'missing' : parsed.ok ? 'ready' : 'invalid';
				if (parsed?.ok) data.products = parsed.manifest.products.map((product) => productView(product, url));
			}
			const response = this.createSuccessResponse(data);
			response.headers.set('Cache-Control', 'private, no-store');
			return response;
		} catch {
			// File contents and upstream diagnostics are deliberately never returned to the client.
			return this.unavailable();
		}
	}

	private static unavailable(): ControllerResponse<ApiResponse<StoreWorkspaceProducts>> {
		return this.createErrorResponse(msg("Couldn't load your published products. Try again in a moment."), 503);
	}
}
