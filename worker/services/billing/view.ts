/** The billing page's view of an account: its plan and subscription, this period's credits, its purchases, and what it may do. */

import type { CreditPurchaseRecord } from '../../database/schema';
import type { BillingView, PurchaseView } from '../../../shared/types/billing';
import { assertWithinLimit, isPaidPlanId } from '../../../shared/types/plans';
import { liveSubscription, type BillingAccount } from './account';
import { creditAlertDue, purchaseLeft, type CreditBalance } from './credit-ledger';

function purchaseView(purchase: CreditPurchaseRecord): PurchaseView {
	return {
		credits: purchase.credits,
		left: purchaseLeft({ credits: purchase.credits, used: purchase.used, removed: purchase.removedCredits }),
		purchasedAt: purchase.purchasedAt.getTime(),
		expiresAt: purchase.expiresAt.getTime(),
	};
}

/** `credits` and `purchases` are null and empty while billing is off for the account; `hasCustomer` is a stored Stripe customer. */
export function billingView(account: BillingAccount, credits: CreditBalance | null, purchases: readonly CreditPurchaseRecord[], hasCustomer: boolean): BillingView {
	const row = account.subscription;
	// A cancel or a pending move only means something while the subscription still holds the plan.
	const live = liveSubscription(row);
	const pendingPlan = live && isPaidPlanId(live.pendingPlan) ? live.pendingPlan : null;
	const balance = account.billing ? credits : null;
	return {
		enabled: account.billing,
		plan: account.plan,
		source: account.source,
		status: row?.status ?? null,
		periodStart: account.period.startMs,
		periodEnd: account.period.endMs,
		cancelAtPeriodEnd: live?.cancelAtPeriodEnd ?? false,
		pendingPlan,
		pendingPlanAt: pendingPlan ? (live?.pendingPlanAt?.getTime() ?? null) : null,
		graceEndsAt: account.graceEndsAtMs,
		paymentFailing: row?.status === 'past_due' || row?.status === 'unpaid',
		credits: balance && {
			pool: balance.pool,
			granted: balance.granted,
			used: balance.used,
			left: balance.left,
			// The balance goes negative when overruns are more than the purchases; the seller just has none left.
			purchasedLeft: Math.max(0, balance.purchasedLeft),
			available: balance.available,
			renewsAt: account.creditsResetAt,
		},
		alert: balance ? creditAlertDue(balance) : null,
		purchases: account.billing ? purchases.map(purchaseView).filter((purchase) => purchase.left > 0) : [],
		limits: account.limits,
		canManageBilling: account.billing && hasCustomer,
		canBuyCredits: account.billing && assertWithinLimit(account, 'extraCredits') === null,
	};
}
