/** What the billing page and the banner show for an account's billing view: its choices, confirmations and notices. */

import {
	BILLING_PATH,
	EXTRA_CREDITS,
	PAID_PLAN_IDS,
	PLAN_LIMITS,
	planPriceCents,
	creditsForPlanChange,
	planChangeStartsNow,
	type BillingInterval,
	assertWithinLimit,
	formatBillingDate,
	formatCredits,
	formatUsd,
	isPaidPlanId,
	planName,
	type BillingView,
	type CardOnFile,
	type PaidPlanId,
	type PurchaseView,
} from '@/api-types';
import { upgradeActionFor, type UpgradeAction } from '@/components/billing/upgrade-action';
import { getLocale, msg, t } from '@/lib/i18n';
import type { SettledPayment } from '@/lib/stripe/next-action';
import { perLocale } from '../../../shared/i18n/format';
import { cardPathOf } from './card-state';

/** The language's own writing of a date, an amount of credits and an amount in dollars. */
const billingDate = (ms: number): string => formatBillingDate(ms, getLocale());
const credits = (count: number): string => formatCredits(count, getLocale());
const usd = (cents: number): string => formatUsd(cents, getLocale());

/** After a checkout, the page asks for the view this often until the webhook has recorded the payment, for up to this long. */
export const CONFIRM_POLL_MS = 2_000;
export const CONFIRM_TIMEOUT_MS = 30_000;

export type CheckoutReturn = 'plan' | 'credits' | 'renewal' | 'cancelled';

/** What a return says the seller paid for, read from the billing page's address: a plan, credits, or a failed renewal. */
export function checkoutReturnOf(search: string): CheckoutReturn | null {
	const params = new URLSearchParams(search);
	const confirm = params.get('confirm');
	if (confirm === 'plan' || confirm === 'credits' || confirm === 'renewal') return confirm;
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
	if (view.source === 'override' || view.plan === 'enterprise') return choice(plan, 'none', t('Set by Estori'), t('Talk to us to change your plan.'));
	if (view.paymentFailing) return plan === view.plan ? choice(plan, 'current', t('Your plan')) : choice(plan, 'none', t('Update your card first'));
	if (view.plan === 'basic') return choice(plan, 'checkout', t('Get {plan}', { plan: planName(plan) }));
	const current = view.plan;
	const name = planName(current);
	if (view.cancelAtPeriodEnd) {
		return plan === current
			? choice(plan, 'resume', t('Keep {plan}', { plan: name }), t('Ends on {date}', { date: billingDate(view.periodEnd) }))
			: choice(plan, 'none', t('Keep {plan} first', { plan: name }));
	}
	if (view.pendingPlan !== null) {
		const date = billingDate(view.pendingPlanAt ?? view.periodEnd);
		return plan === current
			? choice(plan, 'cancel-change', t('Keep {plan}', { plan: name }), t('Moves to {plan} on {date}', { plan: planName(view.pendingPlan), date }))
			: choice(plan, 'none', t('Starts {date}', { date }));
	}
	if (plan === current) return choice(plan, 'current', t('Your plan'));
	return plan === 'premium'
		? choice(plan, 'upgrade', t('Move to {plan}', { plan: planName('premium') }))
		: choice(plan, 'downgrade', t('Move to {plan} at renewal', { plan: planName('pro') }));
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
	const renewal = billingDate(view.periodEnd);
	const pro = planName('pro');
	const premium = planName('premium');
	switch (action) {
		case 'upgrade':
			return {
				title: t('Move to {plan} now?', { plan: premium }),
				body:
					view.billingInterval === 'year'
						? t(
								'You will have {credits} AI credits a month right away. This month’s usage counts against them. We will charge the difference for the rest of your paid year; Premium then renews at {price} a year.',
								{ credits: credits(creditsForPlanChange('premium', view.monthlyCredits)), price: usd(planPriceCents('premium', 'year', creditsForPlanChange('premium', view.monthlyCredits))) },
							)
						: t(
								"You'll have {credits} AI credits a month right away, and the credits you've used this month count against them. We'll charge the difference for the rest of this month, then {plan} renews at {price} a month.",
								{ credits: credits(creditsForPlanChange('premium', view.monthlyCredits)), plan: premium, price: usd(planPriceCents('premium', 'month', creditsForPlanChange('premium', view.monthlyCredits))) },
							),
				confirm: t('Move to {plan}', { plan: premium }),
			};
		case 'downgrade':
			return {
				title: t('Move to {plan} at renewal?', { plan: pro }),
				body:
					view.billingInterval === 'year'
						? t('You keep Premium until {date}. Then Pro renews at {price} a year, with {credits} AI credits each month. Your paid year is not refunded.', {
								date: renewal,
								price: usd(planPriceCents('pro', 'year', creditsForPlanChange('pro', view.monthlyCredits))),
								credits: credits(creditsForPlanChange('pro', view.monthlyCredits)),
							})
						: t(
								"You keep {premium} until {date}. Then {pro} renews at {price} a month, with {credits} AI credits a month. There's no refund for the rest of this month.",
								{
									premium,
									date: renewal,
									pro,
									price: usd(planPriceCents('pro', 'month', creditsForPlanChange('pro', view.monthlyCredits))),
									credits: credits(creditsForPlanChange('pro', view.monthlyCredits)),
								},
							),
				confirm: t('Move to {plan}', { plan: pro }),
			};
		case 'cancel': {
			const name = planName(view.plan);
			return {
				title: t('Cancel {plan}?', { plan: name }),
				body: t('{plan} stays on until {date}, then your account moves to Basic. Your stores stay live.', { plan: name, date: renewal }),
				confirm: t('Cancel {plan}', { plan: name }),
			};
		}
	}
}

/** A change the seller asked Stripe for on this page. */
export type PlanAction = ConfirmedAction | 'resume' | 'cancel-change' | 'interval-change';

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
		case 'interval-change':
			return view.pendingBillingInterval !== null && view.pendingBillingInterval !== undefined;
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
		return t("Your last payment didn't go through. {plan}'s features keep working until {date}, and this month's AI credits start once the payment goes through.", {
			plan: planName(view.plan),
			date: billingDate(view.graceEndsAt),
		});
	}
	return t("Your last payment didn't go through, so your account is on Basic until it's paid.");
}

export function planStatusFor(view: BillingView): string {
	if (view.source === 'override') return t('Set by Estori');
	if (view.paymentFailing) return t('Payment failing');
	if (view.cancelAtPeriodEnd) return t('Ending');
	return view.source === 'subscription' ? t('Active') : t('Free');
}

/** True once the webhook has recorded a paid renewal, so the page stops asking. */
export function isRenewalPaid(view: BillingView): boolean {
	return !view.paymentFailing;
}

/** When the plan renews, ends or changes; null while a failed payment's note says what happens instead. */
export function renewalLineFor(view: BillingView): string | null {
	if (paymentAtStake(view)) return null;
	if (view.cancelAtPeriodEnd) return t('Ends on {date}', { date: billingDate(view.periodEnd) });
	if (view.pendingPlan === view.plan && view.pendingMonthlyCredits !== undefined && (view.pendingMonthlyCredits ?? PLAN_LIMITS[view.plan].aiCredits) !== (view.monthlyCredits ?? PLAN_LIMITS[view.plan].aiCredits)) return t('Changes to {credits} AI credits a month on {date}', { credits: credits(view.pendingMonthlyCredits ?? PLAN_LIMITS[view.plan].aiCredits), date: billingDate(view.pendingPlanAt ?? view.periodEnd) });
	if (view.pendingPlan === view.plan && view.pendingBillingInterval)
		return view.pendingBillingInterval === 'year'
			? t('Changes to yearly billing on {date}', { date: billingDate(view.pendingPlanAt ?? view.periodEnd) })
			: t('Changes to monthly billing on {date}', { date: billingDate(view.pendingPlanAt ?? view.periodEnd) });
	if (view.pendingPlan !== null) return t('Moves to {plan} on {date}', { plan: planName(view.pendingPlan), date: billingDate(view.pendingPlanAt ?? view.periodEnd) });
	if (view.source === 'subscription') return t('Renews on {date}', { date: billingDate(view.periodEnd) });
	return t('AI credits renew on {date}', { date: billingDate(view.credits?.renewsAt ?? view.periodEnd) });
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
	const { credits: period } = view;
	if (!period) return null;
	const monthly = period.pool + period.granted;
	const usedOfMonthly = Math.min(period.used, monthly);
	const overrun = period.used - usedOfMonthly;
	// The purchases' own balances, before this month's overrun is taken from them, bound what they covered.
	const covered = Math.min(
		overrun,
		view.purchases.reduce((sum, purchase) => sum + purchase.left, 0),
	);
	let overrunNote: string | null = null;
	if (overrun > 0) {
		if (covered === overrun) overrunNote = t('Your extra credits covered the other {credits}.', { credits: credits(overrun) });
		else if (covered > 0) {
			overrunNote = t('{credits} more were used to finish turns that were already running, {covered} of them from your extra credits.', {
				credits: credits(overrun),
				covered: credits(covered),
			});
		} else overrunNote = t('{credits} more were used to finish turns that were already running.', { credits: credits(overrun) });
	}
	return {
		meterLabel: t('{used} of {total} AI credits used this month', { used: credits(usedOfMonthly), total: credits(monthly) }),
		meterPercent: monthly > 0 ? (usedOfMonthly / monthly) * 100 : 0,
		monthlyLeft: monthly - usedOfMonthly,
		extraLeft: period.purchasedLeft,
		overrunNote,
	};
}

const expiryDate = perLocale((intl) => new Intl.DateTimeFormat(intl, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }));

/** "5,000 left, expire October 19, 2027": purchases last a year, so the year is part of the date. */
export function purchaseLineFor(purchase: PurchaseView): string {
	return t('{credits} left, expire {date}', { credits: credits(purchase.left), date: expiryDate(getLocale()).format(purchase.expiresAt) });
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
				? t("Your last payment didn't go through. Update your card by {date} to keep {plan}.", { date: billingDate(view.graceEndsAt), plan: planName(view.plan) })
				: t("Your last payment didn't go through, so your account is on Basic until it's paid. Update your card.");
		return { tone: 'warning', message, action: { kind: 'link', to: BILLING_PATH, label: t('Open billing') } };
	}
	if (view.alert === null || view.credits === null) return null;
	const { credits: period, limits } = view;
	// The refusal the account would get with no credits left names its next step, so the banner offers the same one.
	const refusal = assertWithinLimit({ billing: true, plan: view.plan, limits, creditsResetAt: period.renewsAt }, 'aiCredits', limits.aiCredits);
	return {
		tone: view.alert === 'credits_5' ? 'warning' : 'info',
		message: t('You have {credits} AI credits left until {date}.', { credits: credits(period.left), date: billingDate(period.renewsAt) }),
		action: refusal ? upgradeActionFor(refusal) : { kind: 'none' },
	};
}

/** Where a closed banner is remembered for the session: one key per notice and period, so the next one still shows. */
export function bannerKeyFor(view: BillingView): string {
	return `billing-banner:${paymentAtStake(view) ? 'payment' : (view.alert ?? 'none')}:${view.credits?.renewsAt ?? view.periodEnd}`;
}

const CARD_BRANDS: Record<string, string> = {
	visa: 'Visa',
	mastercard: 'Mastercard',
	// i18n-ignore: a brand name
	amex: 'American Express',
	discover: 'Discover',
	// i18n-ignore: a brand name
	diners: 'Diners Club',
	jcb: 'JCB',
	unionpay: 'UnionPay',
	// i18n-ignore: a brand name
	cartes_bancaires: 'Cartes Bancaires',
	eftpos_au: 'EFTPOS',
};

function brandNameOf(brand: string): string | null {
	return CARD_BRANDS[brand] ?? null;
}

/** "Visa ending 4242, expires 08/28"; a brand it doesn't know is a card. */
export function cardLabelFor(card: CardOnFile): string {
	const month = String(card.expMonth).padStart(2, '0');
	const year = String(card.expYear % 100).padStart(2, '0');
	return t('{brand} ending {last4}, expires {month}/{year}', { brand: brandNameOf(card.brand) ?? t('Card'), last4: card.last4, month, year });
}

export const UPDATE_CARD_AND_PAY_LABEL = msg('Update card and pay');

export interface PastDueActions {
	/** The "Pay now" button's words, or null when there is no card on file to pay with. */
	payNow: string | null;
	updateCard: { label: string; to: string };
}

/** What a seller whose renewal failed can do about it on the billing page; null while payments are fine. */
export function pastDueActionsFor(view: BillingView): PastDueActions | null {
	if (!paymentAtStake(view)) return null;
	const { card } = view;
	return {
		payNow: card ? t('Pay now with {brand} ending {last4}', { brand: brandNameOf(card.brand) ?? t('card'), last4: card.last4 }) : null,
		updateCard: { label: t(UPDATE_CARD_AND_PAY_LABEL), to: cardPathOf('pay') },
	};
}

export const PAYMENT_WENT_THROUGH_MESSAGE = msg('Your payment went through.');
export const CARD_SAVED_MESSAGE = msg('Your card is saved.');
const PAYMENT_DECLINED_MESSAGE = msg("The payment didn't go through. Try another card.");

export interface PaymentNotice {
	tone: 'success' | 'error';
	message: string;
}

/** What to tell the seller about an invoice payment or a saved card. */
export function describePaymentResult(result: SettledPayment): PaymentNotice {
	switch (result.state) {
		case 'paid':
		case 'nothing_due':
			return { tone: 'success', message: t(PAYMENT_WENT_THROUGH_MESSAGE) };
		case 'saved':
			return { tone: 'success', message: t(CARD_SAVED_MESSAGE) };
		case 'declined':
			return { tone: 'error', message: t(result.message || PAYMENT_DECLINED_MESSAGE) };
	}
}

export interface PlanConfiguration { plan: PaidPlanId; interval: BillingInterval; monthlyCredits: number }
export function configurationConfirmation(view: BillingView, target: PlanConfiguration): Confirmation {
 const amount = usd(planPriceCents(target.plan, target.interval, target.monthlyCredits));
 const price = target.interval === 'year' ? t('{amount} a year', { amount }) : t('{amount} a month', { amount });
 const now = (view.plan === 'pro' || view.plan === 'premium') && planChangeStartsNow(view.plan, target.plan, view.billingInterval ?? 'month', target.interval, view.monthlyCredits ?? PLAN_LIMITS[view.plan].aiCredits, target.monthlyCredits);
 return { title: t('Change your plan and credits?'), confirm: t('Confirm change'), body: now
  ? t('Move to {plan} with {credits} AI credits a month now. This month’s usage counts against them. We will charge the difference for the rest of your paid period. Your subscription then renews at {price}.', { plan: planName(target.plan), credits: credits(target.monthlyCredits), price })
  : t('On {date}, your subscription changes to {plan} with {credits} AI credits each month, at {price}. Your current paid period stays unchanged.', { date: billingDate(view.periodEnd), plan: planName(target.plan), credits: credits(target.monthlyCredits), price }) };
}
export function configurationMatches(view: BillingView, target: PlanConfiguration): boolean {
 if (view.plan === target.plan && (view.billingInterval ?? 'month') === target.interval && (view.monthlyCredits ?? PLAN_LIMITS[target.plan].aiCredits) === target.monthlyCredits) return true;
 return view.pendingPlan === target.plan && (view.pendingBillingInterval ?? view.billingInterval ?? 'month') === target.interval && (view.pendingMonthlyCredits ?? PLAN_LIMITS[target.plan].aiCredits) === target.monthlyCredits;
}
