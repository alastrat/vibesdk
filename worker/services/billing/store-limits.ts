import { assertWithinLimit } from '../i18n/plan-limits';
/** Starting a new store on a plan: each standard plan caps the account's lifetime total; custom overrides may also cap starts per day. */

import { BillingService } from '../../database/services/BillingService';
import { RateLimitService } from '../rate-limit/rateLimits';
import type { RateLimitSettings } from '../rate-limit/config';
import type { AuthUser } from '../../types/auth-types';
import { createLogger } from '../../logger';
import { RateLimitExceededError } from '../../../shared/types/errors';
import { type PlanLimitRefusal } from '../../../shared/types/plans';
import type { BillingAccount } from './account';

const logger = createLogger('StoreLimits');
const DAY_SECONDS = 86_400;

export interface StoreStartDeps {
	/** Counts the store against the account's lifetime total; a null cap always reserves. */
	reserveStore(cap: number | null): Promise<{ reserved: boolean; started: number }>;
	/** Takes one of today's new-store places, or false once `limit` are taken. */
	takeDailyStore(limit: number): Promise<boolean>;
}

/**
 * The refusal for a new store, or null once it's counted. Every start is counted, billing on or off, so stores started
 * before billing, or on a paid plan, still count if the account moves to Basic. A start that fails later still counts.
 * With billing on the count is the limit, so a failed write fails the start; with billing off it never stops one.
 */
export async function checkStoreStart(deps: StoreStartDeps, account: BillingAccount): Promise<PlanLimitRefusal | null> {
	if (!account.billing) {
		try {
			await deps.reserveStore(null);
		} catch (error) {
			logger.error('A new store could not be counted', { userId: account.userId, error });
		}
		return null;
	}
	const perDay = account.limits.newStoresPerDay;
	if (perDay !== null && !(await deps.takeDailyStore(perDay))) return assertWithinLimit(account, 'newStoresPerDay', perDay);
	const place = await deps.reserveStore(account.limits.storesLifetime);
	return place.reserved ? null : assertWithinLimit(account, 'storesLifetime', place.started);
}

/** The lifetime count in D1, and the plan's daily limit on the app-creation rate limiter in place of its usual limit. */
export function storeStartDepsFromEnv(env: Env, user: AuthUser, request: Request, rateLimit: RateLimitSettings): StoreStartDeps {
	return {
		reserveStore: (cap) => new BillingService(env).reserveStore(user.id, cap, new Date()),
		takeDailyStore: async (limit) => {
			const appCreation = { ...rateLimit.appCreation, enabled: true, limit, dailyLimit: limit, period: DAY_SECONDS };
			try {
				await RateLimitService.enforceAppCreationRateLimit(env, { ...rateLimit, appCreation }, user, request);
				return true;
			} catch (error) {
				if (error instanceof RateLimitExceededError) return false;
				throw error;
			}
		},
	};
}
