/** What flags and person properties know about an account's plan. */

import type { PlanId } from '../../../shared/types/plans';
import { BillingService } from '../../database/services/BillingService';
import { PlanAdminService } from '../../database/services/PlanAdminService';
import { resolvePlan } from '../billing/account';

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
