import { msg } from '../../../../shared/i18n/translate';
import type { AddStoreProduct } from '../../../../shared/types/account-products';
import { AccountProductsService } from '../../../database/services/AccountProductsService';
import {
	ProductAssetService,
	readBoundedBody,
} from '../../../services/account-products/assets';
import {
	ProductError,
	visibilityOf,
} from '../../../services/account-products/validation';
import type { RouteContext } from '../../types/route-context';
import { BaseController } from '../baseController';

/** All endpoints require a signed-in owner; individual IDs are checked again by the services. */
export class AccountProductsController extends BaseController {
	static async handle(
		request: Request,
		env: Env,
		_ctx: ExecutionContext,
		context: RouteContext,
	): Promise<Response> {
		if (!context.user || context.user.isAnonymous)
			return this.createErrorResponse(
				msg('Sign in to manage products'),
				401,
			);
		const owner = context.user.id;
		const service = new AccountProductsService(env);
		const assets = new ProductAssetService(env);
		const { productId, assetId, id: appId } = context.pathParams;
		const url = new URL(request.url);
		try {
			let data: unknown;
			if (
				url.pathname === '/api/my-products/assets' ||
				assetId !== undefined
			) {
				if (request.method === 'GET')
					return await assets.serveOwned(owner, assetId);
				data = await assets.upload(
					owner,
					request,
					url.searchParams.get('kind'),
				);
			} else if (appId) {
				if (request.method === 'GET') {
					const mode = url.searchParams.get('mode') ?? 'test';
					if (mode !== 'test' && mode !== 'live')
						throw new ProductError(msg('Invalid order mode'));
					data = await service.collection(owner, appId, mode);
				} else if (request.method === 'DELETE') {
					await service.detach(owner, appId, productId);
					data = { detached: true };
				} else {
					const body = await this.body(request);
					data =
						request.method === 'POST'
							? await service.attach(
									owner,
									appId,
									body as AddStoreProduct,
								)
							: await service.setVisibility(
									owner,
									appId,
									productId,
									visibilityOf(body.visibility),
								);
				}
			} else if (request.method === 'GET') {
				data = await service.list(owner);
			} else {
				const body = await this.body(request);
				if (url.pathname.endsWith('/archive'))
					data = await service.archive(
						owner,
						productId,
						body.archived as boolean,
						body.revision as number,
					);
				else if (request.method === 'POST')
					data = await service.create(owner, body);
				else data = await service.update(owner, productId, body);
			}
			const response = this.createSuccessResponse(data);
			response.headers.set('Cache-Control', 'private, no-store');
			return response;
		} catch (error) {
			if (error instanceof ProductError)
				return this.createErrorResponse(error.message, error.status);
			this.logger.error('Private product operation failed', {
				method: request.method,
			});
			return this.createErrorResponse(
				msg('Could not save or load products. Try again.'),
				500,
			);
		}
	}
	private static async body(
		request: Request,
	): Promise<Record<string, unknown>> {
		const bytes = await readBoundedBody(request, 128 * 1024);
		try {
			const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
			if (!value || typeof value !== 'object' || Array.isArray(value))
				throw new Error();
			return value as Record<string, unknown>;
		} catch {
			throw new ProductError(msg('Invalid JSON body'));
		}
	}
}
