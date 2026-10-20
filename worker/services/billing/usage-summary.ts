/** The limit, usage and check fields of GET /api/limits/usage for an account inside the billing flag. */

import type { PlanId } from '../../../shared/types/plans';
import type { BillingAccount } from './account';
import type { CreditBalance } from './credit-ledger';

export interface BillingUsage {
	config: {
		limit: { type: 'credits'; window: 'monthly'; maxValue: number; enabled: true; resetAt: string };
		unlimited: false;
	};
	usage: { credits: { monthly: number } };
	limitCheck: { withinLimits: boolean; exceededLimits: never[]; message: string };
	billing: { plan: PlanId; renewsAt: number };
}

/** This period's credits in the shape the usage badge reads: what's available, what's used, and when it renews. */
export function billingUsage(account: BillingAccount, balance: CreditBalance): BillingUsage {
	const withinLimits = balance.left > 0;
	return {
		config: {
			limit: { type: 'credits', window: 'monthly', maxValue: balance.available, enabled: true, resetAt: new Date(account.period.endMs).toISOString() },
			unlimited: false,
		},
		usage: { credits: { monthly: balance.used } },
		limitCheck: { withinLimits, exceededLimits: [], message: withinLimits ? 'Within limits' : 'Limit exceeded' },
		billing: { plan: account.plan, renewsAt: account.period.endMs },
	};
}
