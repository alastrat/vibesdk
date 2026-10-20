/** Starting a new store on a plan: Pro and Premium are limited per day, Basic over the account's lifetime. */

import { BillingService } from '../../database/services/BillingService';
import { RateLimitService } from '../rate-limit/rateLimits';
import type { RateLimitSettings } from '../rate-limit/config';
import type { AuthUser } from '../../types/auth-types';
import { RateLimitExceededError } from '../../../shared/types/errors';
import { assertWithinLimit, type PlanLimitRefusal } from '../../../shared/types/plans';
import type { BillingAccount } from './account';

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
 */
export async function checkStoreStart(deps: StoreStartDeps, account: BillingAccount): Promise<PlanLimitRefusal | null> {
	if (!account.billing) {
		await deps.reserveStore(null);
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
