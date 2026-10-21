/**
 * The old daily AI allowance, which meters the Think agent and seller tasks while billing is off: each model call counts
 * its model's flat credit cost against the user's daily limit and is never refused for it.
 */

import { getUserConfigurableSettings } from '../../config';
import type { RateLimitSettings } from './config';
import { RateLimitService } from './rateLimits';
import { hasCloudflareConfigured } from './usageChecker';

export interface DailyAllowance {
	config: RateLimitSettings;
	/** True when the user's own Cloudflare account pays, which exempts them if the limits say so. */
	hasCloudflareConfigured: boolean;
}

/** `ownAccountPays` is for calls the user's connected Cloudflare account may pay for; Estori's own calls never are. */
export async function loadDailyAllowance(env: Env, userId: string, options: { ownAccountPays: boolean }): Promise<DailyAllowance> {
	const userConfig = await getUserConfigurableSettings(env, userId);
	return { config: userConfig.security.rateLimit, hasCloudflareConfigured: options.ownAccountPays && (await hasCloudflareConfigured(env, userId)) };
}

/**
 * Counts one call at `creditCost` against the allowance. Never throws for a spent allowance. `label` names the caller in
 * the limiter's logs; the limiter reads nothing else from it while a flat `creditCost` is given.
 */
export async function countDailyCall(env: Env, allowance: DailyAllowance, userId: string, creditCost: number, label: 'Think' | 'Task'): Promise<void> {
	await RateLimitService.enforceLLMCallsRateLimit(env, allowance.config, userId, label, '', false, allowance.hasCloudflareConfigured, {
		creditCost,
		throwOnExceeded: false,
	});
}

/** What's left of the allowance today: null when no limit applies, 0 when it is spent. */
export async function dailyCreditsLeft(env: Env, allowance: DailyAllowance, userId: string): Promise<number | null> {
	const limit = allowance.config.llmCalls;
	if (!limit.enabled || (allowance.hasCloudflareConfigured && limit.excludeCloudflareConnected)) return null;
	return (await RateLimitService.getRemainingCredits(env, allowance.config, userId)).remaining;
}
