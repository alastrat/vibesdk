import type { PublicPlanLimits } from '../../../shared/types/plan';
import type { RateLimitSettings } from './config';

const DAY_SECONDS = 24 * 60 * 60;

interface DailyCountable {
	enabled: boolean;
	limit?: number;
	period?: number;
	dailyLimit?: number;
	calendarDaily?: boolean;
}

function perDay(config: DailyCountable): number | null {
	if (!config.enabled) return null;
	if (typeof config.dailyLimit === 'number') return config.dailyLimit;
	if (typeof config.limit !== 'number') return null;
	return config.calendarDaily || config.period === DAY_SECONDS ? config.limit : null;
}

/** The limits shown on the pricing page, read from the configuration in force. */
export function publicPlanFromSettings(rateLimit: RateLimitSettings): PublicPlanLimits {
	return {
		newSitesPerDay: perDay(rateLimit.appCreation),
		aiCreditsPerDay: perDay(rateLimit.llmCalls),
	};
}
