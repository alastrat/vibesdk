/** What the billing page and the banner show for an account's billing view: its choices, confirmations and notices. */

import {
	EXTRA_CREDITS,
	PAID_PLAN_IDS,
	PLAN_LIMITS,
	PLAN_PRICES_CENTS,
	assertWithinLimit,
	formatBillingDate,
	formatCredits,
	formatUsd,
	isPaidPlanId,
	planName,
	type BillingView,
	type PaidPlanId,
	type PurchaseView,
} from '@/api-types';
import { upgradeActionFor, type UpgradeAction } from '@/components/billing/upgrade-action';

/** After a checkout, the page asks for the view this often until the webhook has recorded the payment, for up to this long. */
export const CONFIRM_POLL_MS = 2_000;
export const CONFIRM_TIMEOUT_MS = 30_000;

export type CheckoutReturn = 'plan' | 'credits' | 'cancelled';

/** Where Stripe sent the seller back from, read from the billing page's address. */
export function checkoutReturnOf(search: string): CheckoutReturn | null {
	const params = new URLSearchParams(search);
	if (params.get('checkout') === 'success') return 'plan';
	if (params.get('credits') === 'success') return 'credits';
	if (params.get('checkout') === 'cancelled') return 'cancelled';
	return null;
}

/** The plan a link asked for, as after signing up from the pricing page. */
export function requestedPlanOf(search: string): PaidPlanId | null {
	const plan = new URLSearchParams(search).get('plan');
	return isPaidPlanId(plan) ? plan : null;
}

export interface PlanChoice {
	plan: PaidPlanId;
	action: 'checkout' | 'upgrade' | 'downgrade' | 'resume' | 'cancel-change' | 'current' | 'none';
	label: string;
	note: string | null;
}

function choice(plan: PaidPlanId, action: PlanChoice['action'], label: string, note: string | null = null): PlanChoice {
	return { plan, action, label, note };
}

function choiceFor(view: BillingView, plan: PaidPlanId): PlanChoice {
	if (view.source === 'override' || view.plan === 'enterprise') return choice(plan, 'none', 'Set by Estori', 'Talk to us to change your plan.');
	if (view.paymentFailing) return plan === view.plan ? choice(plan, 'current', 'Your plan') : choice(plan, 'none', 'Update your card first');
	if (view.plan === 'basic') return choice(plan, 'checkout', `Get ${planName(plan)}`);
	const current = view.plan;
	const name = planName(current);
	if (view.cancelAtPeriodEnd) {
		return plan === current ? choice(plan, 'resume', `Keep ${name}`, `Ends on ${formatBillingDate(view.periodEnd)}`) : choice(plan, 'none', `Keep ${name} first`);
	}
	if (view.pendingPlan !== null && view.pendingPlan !== current) {
		const on = formatBillingDate(view.pendingPlanAt ?? view.periodEnd);
		return plan === current ? choice(plan, 'cancel-change', `Keep ${name}`, `Moves to ${planName(view.pendingPlan)} on ${on}`) : choice(plan, 'none', `Starts ${on}`);
	}
	if (plan === current) return choice(plan, 'current', 'Your plan');
	return plan === 'premium' ? choice(plan, 'upgrade', 'Move to Premium') : choice(plan, 'downgrade', 'Move to Pro at renewal');
}

/** Pro's and Premium's next step for the account, in that order. */
export function planChoicesFor(view: BillingView): PlanChoice[] {
	return PAID_PLAN_IDS.map((plan) => choiceFor(view, plan));
}

export type ConfirmedAction = 'upgrade' | 'downgrade' | 'cancel';

export interface Confirmation {
	title: string;
	body: string;
	confirm: string;
}

/** What a change charges or ends, said before the seller confirms it. */
export function confirmationFor(view: BillingView, action: ConfirmedAction): Confirmation {
	const renewal = formatBillingDate(view.periodEnd);
	const pro = planName('pro');
	const premium = planName('premium');
	switch (action) {
		case 'upgrade':
			return {
				title: `Move to ${premium} now?`,
				body: `You'll have ${formatCredits(PLAN_LIMITS.premium.aiCredits)} AI credits a month right away, and the credits you've used this month count against them. We'll charge the difference for the rest of this month, then ${premium} renews at ${formatUsd(PLAN_PRICES_CENTS.premium)} a month.`,
				confirm: `Move to ${premium}`,
			};
		case 'downgrade':
			return {
				title: `Move to ${pro} at renewal?`,
				body: `You keep ${premium} until ${renewal}. Then ${pro} renews at ${formatUsd(PLAN_PRICES_CENTS.pro)} a month, with ${formatCredits(PLAN_LIMITS.pro.aiCredits)} AI credits a month. There's no refund for the rest of this month.`,
				confirm: `Move to ${pro}`,
			};
		case 'cancel': {
			const name = planName(view.plan);
			return { title: `Cancel ${name}?`, body: `${name} stays on until ${renewal}, then your account moves to Basic. Your stores stay live.`, confirm: `Cancel ${name}` };
		}
	}
}

/** A change the seller asked Stripe for on this page. */
export type PlanAction = ConfirmedAction | 'resume' | 'cancel-change';

/** True once the view shows the change, so the page can stop asking for it. */
export function showsChange(action: PlanAction, view: BillingView): boolean {
	switch (action) {
		case 'upgrade':
			return view.plan === 'premium';
		case 'downgrade':
			return view.pendingPlan === 'pro';
		case 'cancel':
			return view.cancelAtPeriodEnd;
		case 'resume':
			return !view.cancelAtPeriodEnd;
		case 'cancel-change':
			return view.pendingPlan === null;
	}
}

/** True while the account pays for Pro or Premium itself and hasn't already cancelled. */
export function canCancel(view: BillingView): boolean {
	return view.source === 'subscription' && isPaidPlanId(view.plan) && !view.cancelAtPeriodEnd;
}

/** What a return from checkout is compared against: the view before it, or what the page kept of it across the trip to Stripe. */
export interface CheckoutBaseline {
	credits: { purchasedLeft: number } | null;
	purchases: readonly { purchasedAt: number }[];
}

export function checkoutBaselineOf(view: BillingView): CheckoutBaseline {
	return {
		credits: view.credits && { purchasedLeft: view.credits.purchasedLeft },
		purchases: view.purchases.map(({ purchasedAt }) => ({ purchasedAt })),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCheckoutBaseline(value: unknown): value is CheckoutBaseline {
	if (!isRecord(value) || !Array.isArray(value.purchases)) return false;
	const { credits } = value;
	return (
		(credits === null || (isRecord(credits) && typeof credits.purchasedLeft === 'number')) &&
		value.purchases.every((purchase: unknown) => isRecord(purchase) && typeof purchase.purchasedAt === 'number')
	);
}

/** A baseline the page stored before leaving for Stripe, or null when there is none or it isn't one. */
export function readCheckoutBaseline(text: string | null): CheckoutBaseline | null {
	if (text === null) return null;
	try {
		const value: unknown = JSON.parse(text);
		return isCheckoutBaseline(value) ? value : null;
	} catch {
		return null;
	}
}

/**
 * True once the webhook has recorded what the seller paid for: a plan, or a credits purchase. A new purchase counts even
 * when this month's overrun used all of it, so the extra credits left didn't grow.
 */
export function isConfirmed(kind: 'plan' | 'credits', initial: CheckoutBaseline, current: BillingView): boolean {
	if (kind === 'plan') return isPaidPlanId(current.plan) && current.source !== 'free';
	const known = new Set(initial.purchases.map((purchase) => purchase.purchasedAt));
	if (current.purchases.some((purchase) => !known.has(purchase.purchasedAt))) return true;
	return (current.credits?.purchasedLeft ?? 0) > (initial.credits?.purchasedLeft ?? 0);
}

/** An admin's plan doesn't depend on a card, so a failing one isn't the seller's problem to fix first. */
function paymentAtStake(view: BillingView): boolean {
	return view.enabled && view.paymentFailing && view.source !== 'override';
}

/** What a failed renewal means for the account, on the billing page; null while payments are fine. */
export function paymentNoteFor(view: BillingView): string | null {
	if (!paymentAtStake(view)) return null;
	if (view.graceEndsAt !== null) {
		return `Your last payment didn't go through. ${planName(view.plan)}'s features keep working until ${formatBillingDate(view.graceEndsAt)}, and this month's AI credits start once the payment goes through.`;
	}
	return "Your last payment didn't go through, so your account is on Basic until it's paid.";
}

export function planStatusFor(view: BillingView): string {
	if (view.source === 'override') return 'Set by Estori';
	if (view.paymentFailing) return 'Payment failing';
	if (view.cancelAtPeriodEnd) return 'Ending';
	return view.source === 'subscription' ? 'Active' : 'Free';
}

/** When the plan renews, ends or changes; null while a failed payment's note says what happens instead. */
export function renewalLineFor(view: BillingView): string | null {
	if (paymentAtStake(view)) return null;
	if (view.cancelAtPeriodEnd) return `Ends on ${formatBillingDate(view.periodEnd)}`;
	if (view.pendingPlan !== null) return `Moves to ${planName(view.pendingPlan)} on ${formatBillingDate(view.pendingPlanAt ?? view.periodEnd)}`;
	if (view.source === 'subscription') return `Renews on ${formatBillingDate(view.periodEnd)}`;
	return `AI credits renew on ${formatBillingDate(view.credits?.renewsAt ?? view.periodEnd)}`;
}

/** This month's credits on the billing page: the pool and grants apart from extra credits, so nothing reads as counted twice. */
export interface CreditsSummary {
	meterLabel: string;
	meterPercent: number;
	/** What's left of the pool and grants. */
	monthlyLeft: number;
	extraLeft: number;
	/** Said under the meter when the month used more than its credits. */
	overrunNote: string | null;
}

export function creditsSummaryFor(view: BillingView): CreditsSummary | null {
	const { credits } = view;
	if (!credits) return null;
	const monthly = credits.pool + credits.granted;
	const usedOfMonthly = Math.min(credits.used, monthly);
	const overrun = credits.used - usedOfMonthly;
	// The purchases' own balances, before this month's overrun is taken from them, bound what they covered.
	const covered = Math.min(overrun, view.purchases.reduce((sum, purchase) => sum + purchase.left, 0));
	let overrunNote: string | null = null;
	if (overrun > 0) {
		overrunNote =
			covered === overrun
				? `Your extra credits covered the other ${formatCredits(overrun)}.`
				: `${formatCredits(overrun)} more were used to finish turns that were already running${covered > 0 ? `, ${formatCredits(covered)} of them from your extra credits` : ''}.`;
	}
	return {
		meterLabel: `${formatCredits(usedOfMonthly)} of ${formatCredits(monthly)} AI credits used this month`,
		meterPercent: monthly > 0 ? (usedOfMonthly / monthly) * 100 : 0,
		monthlyLeft: monthly - usedOfMonthly,
		extraLeft: credits.purchasedLeft,
		overrunNote,
	};
}

const EXPIRY_DATE = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** "5,000 left, expire October 19, 2027": purchases last a year, so the year is part of the date. */
export function purchaseLineFor(purchase: PurchaseView): string {
	return `${formatCredits(purchase.left)} left, expire ${EXPIRY_DATE.format(purchase.expiresAt)}`;
}

/** The nearest amount of extra credits Stripe sells: whole thousands from the minimum to the maximum. */
export function clampExtraCredits(credits: number): number {
	if (!Number.isFinite(credits)) return EXTRA_CREDITS.minCredits;
	const thousands = Math.round(credits / EXTRA_CREDITS.creditsPerUnit) * EXTRA_CREDITS.creditsPerUnit;
	return Math.min(EXTRA_CREDITS.maxCredits, Math.max(EXTRA_CREDITS.minCredits, thousands));
}

export interface BillingBanner {
	tone: 'warning' | 'info';
	message: string;
	action: UpgradeAction;
}

/** The app-wide banner: a failed payment first, then a credits warning with the plan's next step; null when there's nothing to say. */
export function billingBannerFor(view: BillingView | undefined): BillingBanner | null {
	if (!view?.enabled) return null;
	if (paymentAtStake(view)) {
		const message =
			view.graceEndsAt !== null
				? `Your last payment didn't go through. Update your card by ${formatBillingDate(view.graceEndsAt)} to keep ${planName(view.plan)}.`
				: "Your last payment didn't go through, so your account is on Basic until it's paid. Update your card.";
		return { tone: 'warning', message, action: { kind: 'none' } };
	}
	if (view.alert === null || view.credits === null) return null;
	const { credits, limits } = view;
	// The refusal the account would get with no credits left names its next step, so the banner offers the same one.
	const refusal = assertWithinLimit({ billing: true, plan: view.plan, limits, creditsResetAt: credits.renewsAt }, 'aiCredits', limits.aiCredits);
	return {
		tone: view.alert === 'credits_5' ? 'warning' : 'info',
		message: `You have ${formatCredits(credits.left)} AI credits left until ${formatBillingDate(credits.renewsAt)}.`,
		action: refusal ? upgradeActionFor(refusal) : { kind: 'none' },
	};
}

/** Where a closed banner is remembered for the session: one key per notice and period, so the next one still shows. */
export function bannerKeyFor(view: BillingView): string {
	return `billing-banner:${paymentAtStake(view) ? 'payment' : (view.alert ?? 'none')}:${view.credits?.renewsAt ?? view.periodEnd}`;
}
