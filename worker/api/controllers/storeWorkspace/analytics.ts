import { getLiveStoreAnalytics } from '../../../services/store-analytics/live';
import type { StoreLiveAnalytics } from '../../../../shared/types/store-analytics';
import { isAnalyticsDay } from '../../../../shared/types/store-analytics';
import { msg } from '../../../../shared/i18n/translate';
import type { StoreTrafficAnalytics } from '../../../../shared/types/store-analytics';
import {
	aggregateStoreAnalytics,
	StoreAnalyticsAccessError,
} from '../../../services/store-analytics/service';
import { BaseController } from '../baseController';
import type { RouteContext } from '../../types/route-context';
import type { ApiResponse, ControllerResponse } from '../types';

export class StoreAnalyticsController extends BaseController {
	static async live(
		request: Request,
		env: Env,
		_ctx: ExecutionContext,
		context: RouteContext,
	): Promise<ControllerResponse<ApiResponse<StoreLiveAnalytics>>> {
		if (!context.user || context.user.isAnonymous)
			return this.createErrorResponse(
				msg('Sign in to manage your store'),
				401,
			);
		const appId = context.pathParams.id;
		if (!appId)
			return this.createErrorResponse(msg('Store not found'), 404);
		const mode = new URL(request.url).searchParams.get('mode') ?? 'live';
		if (mode !== 'live' && mode !== 'test')
			return this.createErrorResponse(
				msg('Invalid analytics period or mode'),
				400,
			);
		try {
			const response = this.createSuccessResponse(
				await getLiveStoreAnalytics(
					env.DB,
					appId,
					context.user.id,
					mode,
				),
			);
			response.headers.set('Cache-Control', 'private, no-store');
			return response;
		} catch (error) {
			if (error instanceof StoreAnalyticsAccessError)
				return this.createErrorResponse(msg('Store not found'), 404);
			return this.createErrorResponse(
				msg("Couldn't load store analytics. Try again in a moment."),
				503,
			);
		}
	}

	static async analytics(
		request: Request,
		env: Env,
		_ctx: ExecutionContext,
		context: RouteContext,
	): Promise<ControllerResponse<ApiResponse<StoreTrafficAnalytics>>> {
		if (!context.user || context.user.isAnonymous)
			return this.createErrorResponse(
				msg('Sign in to manage your store'),
				401,
			);
		const appId = context.pathParams.id;
		if (!appId)
			return this.createErrorResponse(msg('Store not found'), 404);
		const params = new URL(request.url).searchParams;
		const days = Number(params.get('days') ?? '30');
		const mode = params.get('mode') ?? 'live';
		const throughDay = params.get('through') ?? undefined;
		const productId = params.get('product') ?? undefined;
		if (
			!Number.isInteger(days) ||
			days < 1 ||
			days > 90 ||
			!['live', 'test'].includes(mode) ||
			(throughDay !== undefined &&
				(!isAnalyticsDay(throughDay) ||
					throughDay > new Date().toISOString().slice(0, 10))) ||
			(productId !== undefined &&
				(!productId.trim() || productId.length > 200))
		)
			return this.createErrorResponse(
				msg('Invalid analytics period or mode'),
				400,
			);
		try {
			const data = await aggregateStoreAnalytics(
				env.DB,
				appId,
				context.user.id,
				days,
				mode as 'live' | 'test',
				Date.now(),
				{ throughDay, productId },
			);
			const response = this.createSuccessResponse(data);
			response.headers.set('Cache-Control', 'private, no-store');
			return response;
		} catch (error) {
			if (error instanceof StoreAnalyticsAccessError)
				return this.createErrorResponse(msg('Store not found'), 404);
			return this.createErrorResponse(
				msg("Couldn't load store analytics. Try again in a moment."),
				503,
			);
		}
	}
}
