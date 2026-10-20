/** Analytics for the browser: PostHog's config, the user's analytics setting, and the flags admin view. */

import { BaseController } from '../baseController';
import type { RouteContext } from '../../types/route-context';
import type { ApiResponse, ControllerResponse } from '../types';
import type { TelemetryConfigData } from '../../../../shared/types/telemetry';
import { posthogConfig } from '../../../services/posthog/config';
import { flagsFor } from '../../../services/posthog/flags';
import { isDev } from '../../../utils/envs';

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
}
