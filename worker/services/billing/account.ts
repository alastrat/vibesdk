/** An account's plan: its subscription, the grace after a failed renewal, an admin's override and the billing flag, resolved into limits and a credit period. */

import { BillingService, PlanAdminService, UserService } from '../../database';
import { CreditLedgerService } from '../../database/services/CreditLedgerService';
import type { PlanOverrideRecord, SubscriptionRecord } from '../../database/schema';
import type { BillingSource } from '../../../shared/types/billing';
import { GRACE_PERIOD_DAYS, isPaidPlanId, limitsFor, planLimitOverridesFrom, type PlanAccount, type PlanId, type PlanLimitOverrides, type PlanLimits } from '../../../shared/types/plans';
import type { CreditBalance, LedgerPeriod } from './credit-ledger';
import { isBillingOn } from './flag';
import { DAY_MS, accountPeriod, subscriptionPeriod } from './periods';

export interface ResolvedPlan {
	plan: PlanId;
	source: BillingSource;
	period: LedgerPeriod;
	graceEndsAtMs: number | null;
	/** Limits set over the plan's row: an admin's, or the credit hold of a subscription whose renewal is unpaid. */
	overrideLimits: PlanLimitOverrides | null;
}

export interface BillingAccount extends PlanAccount {
	userId: string;
	source: BillingSource;
	period: LedgerPeriod;
	graceEndsAtMs: number | null;
	subscription: SubscriptionRecord | null;
}

/** A renewal's credits come when its invoice is paid, so an unpaid one keeps the plan's features but none of its monthly pool. */
const UNPAID_RENEWAL_LIMITS: PlanLimitOverrides = { aiCredits: 0 };

/** When a failing payment stops holding the plan; null unless the subscription is past due. */
export function graceEndsAt(subscription: SubscriptionRecord): number | null {
	return subscription.status === 'past_due' ? subscription.currentPeriodStart.getTime() + GRACE_PERIOD_DAYS * DAY_MS : null;
}

function paysForItsPlan(subscription: SubscriptionRecord | null, nowMs: number): subscription is SubscriptionRecord {
	if (!subscription || !isPaidPlanId(subscription.plan)) return false;
	if (subscription.status === 'active' || subscription.status === 'trialing') return true;
	const graceEnd = graceEndsAt(subscription);
	return graceEnd !== null && nowMs < graceEnd;
}

function overrideLimitsOf(override: PlanOverrideRecord): PlanLimitOverrides | null {
	try {
		return planLimitOverridesFrom(JSON.parse(override.limits));
	} catch {
		return null;
	}
}

export function resolvePlan(input: { subscription: SubscriptionRecord | null; override: PlanOverrideRecord | null; signupMs: number | null; nowMs: number }): ResolvedPlan {
	const { override, signupMs, nowMs } = input;
	const paying = paysForItsPlan(input.subscription, nowMs) ? input.subscription : null;
	const period = paying ? subscriptionPeriod(paying) : accountPeriod(signupMs, nowMs);
	const graceEndsAtMs = paying ? graceEndsAt(paying) : null;
	if (override?.plan && (override.until === null || override.until.getTime() > nowMs)) {
		return { plan: override.plan, source: 'override', period, graceEndsAtMs, overrideLimits: overrideLimitsOf(override) };
	}
	if (paying) return { plan: paying.plan, source: 'subscription', period, graceEndsAtMs, overrideLimits: graceEndsAtMs === null ? null : UNPAID_RENEWAL_LIMITS };
	return { plan: 'basic', source: 'free', period, graceEndsAtMs: null, overrideLimits: null };
}

/** The limits a resolved plan runs on. */
export function planLimitsOf(resolved: Pick<ResolvedPlan, 'plan' | 'overrideLimits'>): PlanLimits {
	return limitsFor({ billing: true, plan: resolved.plan, adminLimits: resolved.overrideLimits });
}

export async function loadAccount(env: Env, userId: string, nowMs: number = Date.now()): Promise<BillingAccount> {
	const billing = isBillingOn(env, userId);
	if (!billing) {
		const period = accountPeriod(null, nowMs);
		return {
			billing,
			userId,
			plan: 'basic',
			limits: limitsFor({ billing, plan: 'basic', adminLimits: null }),
			creditsResetAt: period.endMs,
			source: 'free',
			period,
			graceEndsAtMs: null,
			subscription: null,
		};
	}
	const [subscription, override, user] = await Promise.all([
		new BillingService(env).subscriptionOf(userId),
		new PlanAdminService(env).latestOverride(userId),
		new UserService(env).findUser({ id: userId }),
	]);
	const resolved = resolvePlan({ subscription, override, signupMs: user?.createdAt?.getTime() ?? null, nowMs });
	return {
		billing,
		userId,
		plan: resolved.plan,
		limits: planLimitsOf(resolved),
		creditsResetAt: resolved.period.endMs,
		source: resolved.source,
		period: resolved.period,
		graceEndsAtMs: resolved.graceEndsAtMs,
		subscription,
	};
}

export function loadCredits(env: Env, account: BillingAccount): Promise<CreditBalance> {
	return new CreditLedgerService(env).readBalance(account.userId, account.period, account.limits.aiCredits);
}
