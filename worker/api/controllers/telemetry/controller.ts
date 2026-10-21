/** Analytics for the browser: PostHog's config, the user's analytics setting, and the flags admin view. */

import { BaseController } from '../baseController';
import type { RouteContext } from '../../types/route-context';
import type { ApiResponse, ControllerResponse } from '../types';
import { FEATURE_FLAGS, FLAG_KEYS, type FlagKey } from '../../../../shared/types/feature-flags';
import { GPC_ANALYTICS_MESSAGE, type AdminFlagRow, type AdminFlagsData, type AnalyticsPreferenceData, type TelemetryConfigData } from '../../../../shared/types/telemetry';
import { AnalyticsPersonService } from '../../../database/services/AnalyticsPersonService';
import { posthogConfig, posthogFlagsUrl } from '../../../services/posthog/config';
import { flagRollouts } from '../../../services/posthog/flag-rollouts';
import { flagsFor, type FlagEvaluation } from '../../../services/posthog/flags';
import { gpcSignal, honorAnalyticsChoice } from '../../../services/posthog/session';
import { isDev } from '../../../utils/envs';

/** Every registry flag beside its live value, and its rollout when the personal key is set. */
export function adminFlagRows(evaluation: FlagEvaluation, rollouts: Partial<Record<FlagKey, number>> | null): AdminFlagRow[] {
	return FLAG_KEYS.map((key) => ({
		key,
		description: FEATURE_FLAGS[key].description,
		kind: FEATURE_FLAGS[key].kind,
		clientVisible: FEATURE_FLAGS[key].clientVisible,
		value: evaluation.values[key],
		inPostHog: evaluation.inPostHog.includes(key),
		rolloutPercent: rollouts ? (rollouts[key] ?? 0) : null,
	}));
}

export class TelemetryController extends BaseController {
	/**
	 * GET /api/telemetry/config: whether replay is paused for visitors who aren't signed in, and, in local development
	 * only, the token a developer opted in with. On estori.app the browser takes the token from its own map.
	 */
	static async config(_request: Request, env: Env, _ctx: ExecutionContext, _context: RouteContext): Promise<ControllerResponse<ApiResponse<TelemetryConfigData>>> {
		const { values } = await flagsFor(env, null);
		const config = posthogConfig(env);
		return this.createSuccessResponse({
			replayPaused: values['session-replay-paused'],
			// The config's own environment, which is dev when ENVIRONMENT is unset, as for the rest of PostHog's setup.
			localProjectKey: config && isDev({ ...env, ENVIRONMENT: config.environment }) ? config.projectKey : null,
		});
	}

	/** GET /api/user/analytics. Reading it with a GPC signal stores the opt-out. */
	static async getAnalyticsPreference(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<AnalyticsPreferenceData>>> {
		const user = context.user;
		if (!user) return this.createErrorResponse<AnalyticsPreferenceData>('Unauthorized', 401);
		try {
			const optedOut = await honorAnalyticsChoice(env, request, user.id);
			const { source } = await new AnalyticsPersonService(env).preference(user.id);
			return this.createSuccessResponse({ optedOut, source: optedOut ? source : null, gpc: gpcSignal(request) });
		} catch (error) {
			return this.handleError(error, 'read the analytics setting') as ControllerResponse<ApiResponse<AnalyticsPreferenceData>>;
		}
	}

	/** PUT /api/user/analytics with `{ optedOut }`. Analytics can't be turned on while the browser sends GPC. */
	static async setAnalyticsPreference(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<AnalyticsPreferenceData>>> {
		const user = context.user;
		if (!user) return this.createErrorResponse<AnalyticsPreferenceData>('Unauthorized', 401);
		const body = await this.parseJsonBody<{ optedOut?: unknown }>(request);
		const optedOut = body.success ? body.data?.optedOut : undefined;
		if (typeof optedOut !== 'boolean') return this.createErrorResponse<AnalyticsPreferenceData>('Say whether analytics is on or off.', 400);
		const gpc = gpcSignal(request);
		if (!optedOut && gpc) return this.createErrorResponse<AnalyticsPreferenceData>(GPC_ANALYTICS_MESSAGE, 409);
		try {
			await new AnalyticsPersonService(env).setPreference(user.id, optedOut, 'settings', new Date());
			return this.createSuccessResponse({ optedOut, source: optedOut ? 'settings' : null, gpc });
		} catch (error) {
			return this.handleError(error, 'save the analytics setting') as ControllerResponse<ApiResponse<AnalyticsPreferenceData>>;
		}
	}

	/** GET /api/admin/flags: every flag's value for the admin asking, its rollout when known, and where to change it. Read-only. */
	static async adminFlags(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<AdminFlagsData>>> {
		const userId = context.user?.id;
		if (!userId) return this.createErrorResponse<AdminFlagsData>('Unauthorized', 401);
		const [evaluation, rollouts] = await Promise.all([flagsFor(env, userId), flagRollouts(env, (input, init) => fetch(input, init))]);
		return this.createSuccessResponse({
			userId,
			source: evaluation.source,
			flags: adminFlagRows(evaluation, rollouts),
			posthogFlagsUrl: posthogFlagsUrl(posthogConfig(env)),
		});
	}
}
