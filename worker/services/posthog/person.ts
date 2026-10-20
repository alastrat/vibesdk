/** An account's plan, for flags and person properties, and the person properties sent with events about it. */

import type { PlanId } from '../../../shared/types/plans';
import { AnalyticsPersonService } from '../../database/services/AnalyticsPersonService';
import { BillingService } from '../../database/services/BillingService';
import { PlanAdminService } from '../../database/services/PlanAdminService';
import { resolvePlan } from '../billing/account';
import type { PersonUpdate } from './analytics';

/**
 * The plan billing's plan resolution gives from the subscription row, the grace period and the latest admin override.
 * It reads those rows itself, not through the account loader, because the account loader asks the billing flag, which
 * asks this. A read that fails answers Basic.
 */
export async function planOf(env: Env, userId: string): Promise<PlanId> {
	try {
		const [subscription, override] = await Promise.all([new BillingService(env).subscriptionOf(userId), new PlanAdminService(env).latestOverride(userId)]);
		// The plan doesn't depend on the sign-up date; only the period does, which isn't needed here.
		return resolvePlan({ subscription, override, signupMs: null, nowMs: Date.now() }).plan;
	} catch {
		return 'basic';
	}
}

/** The person properties to set with an event about this user; empty when they can't be read, never throwing. */
export async function personUpdateOf(env: Env, userId: string): Promise<PersonUpdate> {
	try {
		const [facts, plan] = await Promise.all([new AnalyticsPersonService(env).personFacts(userId), planOf(env, userId)]);
		if (!facts) return {};
		const update: PersonUpdate = { set: { plan, seller_level: facts.sellerLevel ?? 'none', has_live_store: facts.hasLiveStore } };
		if (facts.createdAt) update.setOnce = { signup_date: facts.createdAt.toISOString().slice(0, 10) };
		return update;
	} catch {
		return {};
	}
}
