/**
 * Limits Controller
 * API endpoints for viewing usage limits
 */

import { BaseController } from '../baseController';
import { RouteContext } from '../../types/route-context';
import { checkUsageAndBalance, isCloudflareGatewayLimitsEnabled } from '../../../services/rate-limit';
import { CloudflareAccountService } from '../../../services/cloudflare/CloudflareAccountService';
import { UserService } from '../../../database/services/UserService';
import { createLogger } from '../../../logger';
import { RateLimitService } from '../../../services/rate-limit/rateLimits';
import { publicPlanFromSettings } from '../../../services/rate-limit/public-plan';
import { RateLimitExceededError } from 'shared/types/errors';
import { isBillingOn } from '../../../services/billing/flag';
import { loadAccount, loadCredits } from '../../../services/billing/account';
import { billingUsage } from '../../../services/billing/usage-summary';

/** The account's AI Gateway connection and the toggle that decides whether it is used. */
async function aiGatewayState(env: Env, userId: string) {
	const [selectedGateway, aiGatewayPref] = await Promise.all([
		new CloudflareAccountService(env).getSelectedGatewayWithAccount(userId),
		new UserService(env).getAiGatewayPreference(userId),
	]);
	// A gateway is "configured" for usage purposes only when one is connected
	// AND the user has the AI Gateway toggle enabled; otherwise platform limits
	// apply. The raw connection state is surfaced separately for the toggle UI.
	const aiGatewayConnected = !!selectedGateway;
	return {
		selectedGateway,
		gateway: {
			hasCloudflareConfigured: aiGatewayConnected && aiGatewayPref.enabled,
			aiGatewayConnected,
			aiGatewayEnabled: aiGatewayPref.enabled,
			aiGatewayPreferenceExplicit: aiGatewayPref.isExplicit,
		},
	};
}

export class LimitsController extends BaseController {
	static logger = createLogger('LimitsController');

	/**
	 * GET /api/limits/plan
	 * The free plan's daily limits for the public pricing page, and whether Pro and Premium are on sale.
	 */
	static async getPublicPlan(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<Response> {
		try {
			await RateLimitService.enforcePublicAppsRateLimit(env, context.config.security.rateLimit, null, request);
		} catch (error) {
			if (error instanceof RateLimitExceededError) return LimitsController.createErrorResponse('Too many requests', 429);
			throw error;
		}
		return LimitsController.createSuccessResponse({
			...publicPlanFromSettings(context.config.security.rateLimit),
			billing: isBillingOn(env, context.user?.id ?? null),
		});
	}

	/**
	 * GET /api/limits/usage
	 * Get current usage and limits for the authenticated user
	 */
	static async getUsage(
		request: Request,
		env: Env,
		_ctx: ExecutionContext,
		context: RouteContext,
	): Promise<Response> {
		const user = context.user;
		if (!user) {
			return LimitsController.createErrorResponse('Authentication required', 401);
		}

		try {
			// With billing on, the account's credits are the limit, whatever Cloudflare Connect says.
			if (isBillingOn(env, user.id)) {
				const [account, { gateway }] = await Promise.all([loadAccount(env, user.id), aiGatewayState(env, user.id)]);
				return LimitsController.createSuccessResponse({
					cloudflareConnectEnabled: false,
					...billingUsage(account, await loadCredits(env, account)),
					hasUserToken: false,
					...gateway,
					cloudflareCredits: null,
				});
			}

			// Token is read from the HttpOnly cookie inside checkUsageAndBalance.
			const [usageResult, { selectedGateway, gateway }] = await Promise.all([
				checkUsageAndBalance(env, user.id, request),
				aiGatewayState(env, user.id),
			]);
			const window = usageResult.windowKind ?? 'rolling';
			const unlimited = !Number.isFinite(usageResult.limit);
			const used = unlimited ? 0 : usageResult.limit - usageResult.remaining;
			// Omit `config.limit` when unlimited: a finite `maxValue` is part of
			// the client contract, but `Infinity` serialises to `null` in JSON
			// and would give clients a misleading `maxValue: null` with
			// `unlimited: false` semantics everywhere else.
			const response = LimitsController.createSuccessResponse({
				cloudflareConnectEnabled: isCloudflareGatewayLimitsEnabled(env),
				config: {
					...(unlimited ? {} : {
						limit: {
							type: 'credits' as const,
							window,
							maxValue: usageResult.limit,
							enabled: true,
							periodSeconds: usageResult.periodSeconds,
							resetAt: usageResult.resetAt,
						},
					}),
					unlimited,
				},
				usage: {
					credits: {
						[window]: used,
					},
				},
				limitCheck: {
					withinLimits: usageResult.withinLimits,
					exceededLimits: usageResult.withinLimits ? [] : [{
						type: 'credits',
						window,
						current: used,
						max: usageResult.limit,
						percentUsed: Number.isFinite(usageResult.limit) && usageResult.limit > 0
							? (used / usageResult.limit) * 100
							: 0,
					}],
					message: usageResult.withinLimits ? 'Within limits' : 'Limit exceeded',
				},
				billing: null,
				hasUserToken: usageResult.hasUserToken,
				...gateway,
				cloudflareCredits: usageResult.balance !== null ? {
					credits: usageResult.balance,
					currency: 'USD',
					...(selectedGateway ? {
						accountId: selectedGateway.account.accountId,
						gatewayName: selectedGateway.gateway.gatewayName,
						accountName: selectedGateway.account.accountName,
					} : {}),
				} : null,
			});
			if (usageResult.refreshedCookie) {
				response.headers.append('Set-Cookie', usageResult.refreshedCookie);
			}
			return response;
		} catch (error) {
			this.logger.error('Error getting usage', error);
			return LimitsController.createErrorResponse(
				error instanceof Error ? error.message : 'Failed to get usage',
				500,
			);
		}
	}
}
