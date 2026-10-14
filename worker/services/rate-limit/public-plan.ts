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

/** The most a user can use in a day; the store enforces both the main window and dailyLimit. */
function perDay(config: DailyCountable): number | null {
	if (!config.enabled) return null;
	const mainPerDay =
		typeof config.limit === 'number' && (config.calendarDaily || config.period === DAY_SECONDS) ? config.limit : null;
	if (typeof config.dailyLimit !== 'number') return mainPerDay;
	return mainPerDay === null ? config.dailyLimit : Math.min(mainPerDay, config.dailyLimit);
}

/** The limits shown on the pricing page, read from the configuration in force. */
export function publicPlanFromSettings(rateLimit: RateLimitSettings): PublicPlanLimits {
	return {
		newSitesPerDay: perDay(rateLimit.appCreation),
		aiCreditsPerDay: perDay(rateLimit.llmCalls),
	};
}
