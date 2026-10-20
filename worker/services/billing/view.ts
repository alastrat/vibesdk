/** The billing page's view of an account: its plan and subscription, this period's credits, its purchases, its card, and what it may do. */

import type { CreditPurchaseRecord } from '../../database/schema';
import type { BillingView, CardOnFile, PurchaseView } from '../../../shared/types/billing';
import { assertWithinLimit, isPaidPlanId } from '../../../shared/types/plans';
import { createLogger } from '../../logger';
import type { StripeClient } from '../payments/stripe-client';
import { liveSubscription, type BillingAccount } from './account';
import { creditAlertDue, purchaseLeft, type CreditBalance } from './credit-ledger';
import { cardOnFile } from './invoices';

const logger = createLogger('BillingView');

function purchaseView(purchase: CreditPurchaseRecord): PurchaseView {
	return {
		credits: purchase.credits,
		left: purchaseLeft({ credits: purchase.credits, used: purchase.used, removed: purchase.removedCredits }),
		purchasedAt: purchase.purchasedAt.getTime(),
		expiresAt: purchase.expiresAt.getTime(),
	};
}

/** How long the billing view waits for Stripe to name the card; the view feeds every page's banner, so it can't wait on Stripe's pace. */
export const CARD_READ_BUDGET_MS = 1_500;

/**
 * The card the account's invoices are charged to: the live subscription's own, else the customer's. Null with no Stripe
 * customer, no card, when Stripe can't say, or when it takes longer than `CARD_READ_BUDGET_MS`; the last two are warnings.
 */
export async function cardForView(
	stripe: Pick<StripeClient, 'retrieveCustomer' | 'retrieveSubscription' | 'retrievePaymentMethod'> | null,
	customerId: string | null,
	account: Pick<BillingAccount, 'userId' | 'subscription'>,
): Promise<CardOnFile | null> {
	if (!stripe || !customerId) return null;
	// Settled with a warning rather than rejected, so a read that fails after the budget ran out is recorded, never unhandled.
	const read = cardOnFile(stripe, customerId, liveSubscription(account.subscription)?.stripeSubscriptionId ?? null).catch((error: unknown) => {
		logger.warn("Could not read the account's card for the billing page", { userId: account.userId, error });
		return null;
	});
	let timer: ReturnType<typeof setTimeout> | undefined;
	const budget = new Promise<null>((resolve) => {
		timer = setTimeout(() => {
			logger.warn("Reading the account's card took too long for the billing page", { userId: account.userId, budgetMs: CARD_READ_BUDGET_MS });
			resolve(null);
		}, CARD_READ_BUDGET_MS);
	});
	try {
		return await Promise.race([read, budget]);
	} finally {
		clearTimeout(timer);
	}
}

/** `credits` and `purchases` are null and empty while billing is off for the account; `hasCustomer` is a stored Stripe customer; `card` comes from `cardForView`. */
export function billingView(account: BillingAccount, credits: CreditBalance | null, purchases: readonly CreditPurchaseRecord[], hasCustomer: boolean, card: CardOnFile | null): BillingView {
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
		card: account.billing ? card : null,
	};
}
