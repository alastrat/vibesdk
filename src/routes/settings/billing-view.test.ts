import { describe, expect, it } from 'vitest';
import { PLAN_LIMITS, type BillingView, type CardOnFile, type PlanId } from '@/api-types';
import {
	CARD_SAVED_MESSAGE,
	PAYMENT_WENT_THROUGH_MESSAGE,
	bannerKeyFor,
	billingBannerFor,
	canCancel,
	cardLabelFor,
	checkoutBaselineOf,
	checkoutReturnOf,
	clampExtraCredits,
	confirmationFor,
	configurationConfirmation,
	configurationMatches,
	creditsSummaryFor,
	describePaymentResult,
	isConfirmed,
	isRenewalPaid,
	pastDueActionsFor,
	paymentNoteFor,
	planChoicesFor,
	planStatusFor,
	purchaseLineFor,
	readCheckoutBaseline,
	renewalLineFor,
	requestedPlanOf,
	showsChange,
} from './billing-view';

const NOV_5 = Date.UTC(2026, 10, 5, 10);

function view(plan: PlanId, overrides: Partial<BillingView> = {}): BillingView {
	return {
		enabled: true,
		plan,
		source: plan === 'basic' ? 'free' : 'subscription',
		status: plan === 'basic' ? null : 'active',
		periodStart: Date.UTC(2026, 9, 5, 10),
		periodEnd: NOV_5,
		cancelAtPeriodEnd: false,
		pendingPlan: null,
		pendingPlanAt: null,
		graceEndsAt: null,
		paymentFailing: false,
		credits: { pool: PLAN_LIMITS[plan].aiCredits, granted: 0, used: 0, left: PLAN_LIMITS[plan].aiCredits, purchasedLeft: 0, available: PLAN_LIMITS[plan].aiCredits, renewsAt: NOV_5 },
		alert: null,
		purchases: [],
		limits: PLAN_LIMITS[plan],
		canManageBilling: plan !== 'basic',
		canBuyCredits: plan === 'premium',
		card: null,
		...overrides,
	};
}

const actions = (choices: ReturnType<typeof planChoicesFor>) => choices.map((choice) => `${choice.plan}:${choice.action}`);

describe('the billing page', () => {
	it('reads where the seller came back from, and the plan a link asked for', () => {
		expect(checkoutReturnOf('?confirm=plan')).toBe('plan');
		expect(checkoutReturnOf('?confirm=credits')).toBe('credits');
		expect(checkoutReturnOf('?confirm=renewal')).toBe('renewal');
		expect(checkoutReturnOf('?confirm=other')).toBeNull();
		expect(checkoutReturnOf('?checkout=success')).toBeNull();
		expect(checkoutReturnOf('?credits=success')).toBeNull();
		expect(checkoutReturnOf('?checkout=cancelled')).toBe('cancelled');
		expect(checkoutReturnOf('')).toBeNull();
		expect(requestedPlanOf('?plan=premium')).toBe('premium');
		expect(requestedPlanOf('?plan=enterprise')).toBeNull();
	});

	it('offers each plan the next step that fits the account', () => {
		expect(actions(planChoicesFor(view('basic')))).toEqual(['pro:checkout', 'premium:checkout']);
		expect(actions(planChoicesFor(view('pro')))).toEqual(['pro:current', 'premium:upgrade']);
		expect(actions(planChoicesFor(view('premium')))).toEqual(['pro:downgrade', 'premium:current']);
		expect(planChoicesFor(view('premium', { pendingPlan: 'pro', pendingPlanAt: NOV_5 }))).toEqual([
			{ plan: 'pro', action: 'none', label: 'Starts November 5', note: null },
			{ plan: 'premium', action: 'cancel-change', label: 'Keep Premium', note: 'Moves to Pro on November 5' },
		]);
		expect(planChoicesFor(view('pro', { cancelAtPeriodEnd: true }))[0]).toEqual({ plan: 'pro', action: 'resume', label: 'Keep Pro', note: 'Ends on November 5' });
		expect(actions(planChoicesFor(view('pro', { status: 'past_due', paymentFailing: true })))).toEqual(['pro:current', 'premium:none']);
		expect(actions(planChoicesFor(view('enterprise', { source: 'override' })))).toEqual(['pro:none', 'premium:none']);
	});

	it('explains a charge or a change before asking to confirm it', () => {
		expect(confirmationFor(view('pro'), 'upgrade')).toEqual({
			title: 'Move to Premium now?',
			body: "You'll have 100,000 AI credits a month right away, and the credits you've used this month count against them. We'll charge the difference for the rest of this month, then Premium renews at $199 a month.",
			confirm: 'Move to Premium',
		});
		expect(confirmationFor(view('premium'), 'downgrade').body).toBe("You keep Premium until November 5. Then Pro renews at $49 a month, with 20,000 AI credits a month. There's no refund for the rest of this month.");
		expect(confirmationFor(view('premium'), 'cancel').body).toBe('Premium stays on until November 5, then your account moves to Basic. Your stores stay live.');
	});

	it('knows when the webhook has recorded a payment', () => {
		expect(isConfirmed('plan', view('basic'), view('basic'))).toBe(false);
		expect(isConfirmed('plan', view('basic'), view('pro'))).toBe(true);
		const before = view('premium', { credits: { ...view('premium').credits!, purchasedLeft: 0 } });
		expect(isConfirmed('credits', before, before)).toBe(false);
		expect(isConfirmed('credits', before, view('premium', { credits: { ...view('premium').credits!, purchasedLeft: 5_000 } }))).toBe(true);
	});

	it("knows when the webhook has recorded a plan change, so the page stops asking", () => {
		expect(showsChange('upgrade', view('pro'))).toBe(false);
		expect(showsChange('upgrade', view('premium'))).toBe(true);
		expect(showsChange('downgrade', view('premium'))).toBe(false);
		expect(showsChange('downgrade', view('premium', { pendingPlan: 'pro', pendingPlanAt: NOV_5 }))).toBe(true);
		expect(showsChange('cancel', view('pro'))).toBe(false);
		expect(showsChange('cancel', view('pro', { cancelAtPeriodEnd: true }))).toBe(true);
		expect(showsChange('resume', view('pro', { cancelAtPeriodEnd: true }))).toBe(false);
		expect(showsChange('resume', view('pro'))).toBe(true);
		expect(showsChange('cancel-change', view('premium', { pendingPlan: 'pro', pendingPlanAt: NOV_5 }))).toBe(false);
		expect(showsChange('cancel-change', view('premium'))).toBe(true);
	});

	it('puts a failed payment, then a credit warning, in the banner, with the next step for the plan', () => {
		expect(billingBannerFor(view('pro', { status: 'past_due', paymentFailing: true, graceEndsAt: NOV_5 }))).toEqual({ tone: 'warning', message: "Your last payment didn't go through. Update your card by November 5 to keep Pro.", action: { kind: 'link', to: '/settings/billing', label: 'Open billing' } });
		const low = { ...view('basic').credits!, used: 4_000, left: 1_000 };
		expect(billingBannerFor(view('basic', { alert: 'credits_20', credits: low }))).toEqual({ tone: 'info', message: 'You have 1,000 AI credits left until November 5.', action: { kind: 'checkout', plan: 'pro', label: 'Get Pro' } });
		expect(billingBannerFor(view('premium', { alert: 'credits_5' }))?.action).toEqual({ kind: 'link', to: '/settings/billing#extra-credits', label: 'Buy credits' });
		expect(billingBannerFor(view('basic'))).toBeNull();
		expect(billingBannerFor(view('basic', { enabled: false, alert: 'credits_5' }))).toBeNull();
	});
});

describe('the billing page, beyond the plan cards', () => {
	it('tells a seller whose renewal failed what keeps working, and what happens once grace ends', () => {
		const grace = view('pro', { status: 'past_due', paymentFailing: true, graceEndsAt: NOV_5 });
		expect(paymentNoteFor(grace)).toBe("Your last payment didn't go through. Pro's features keep working until November 5, and this month's AI credits start once the payment goes through.");
		const ended = view('basic', { source: 'free', status: 'past_due', paymentFailing: true });
		expect(paymentNoteFor(ended)).toBe("Your last payment didn't go through, so your account is on Basic until it's paid.");
		expect(billingBannerFor(ended)).toEqual({ tone: 'warning', message: "Your last payment didn't go through, so your account is on Basic until it's paid. Update your card.", action: { kind: 'link', to: '/settings/billing', label: 'Open billing' } });
		expect(actions(planChoicesFor(ended))).toEqual(['pro:none', 'premium:none']);
		expect(paymentNoteFor(view('pro'))).toBeNull();
	});

	it("doesn't warn about a payment while Estori sets the plan, since the plan doesn't depend on it", () => {
		const comped = view('enterprise', { source: 'override', status: 'past_due', paymentFailing: true, graceEndsAt: NOV_5 });
		expect(paymentNoteFor(comped)).toBeNull();
		expect(billingBannerFor(comped)).toBeNull();
	});

	it('warns at 5% left, and keys each dismissal to the warning and the period', () => {
		const nearlyOut = view('pro', { alert: 'credits_5' });
		expect(billingBannerFor(nearlyOut)).toMatchObject({ tone: 'warning', action: { kind: 'link', to: '/settings/billing?plan=premium', label: 'Move to Premium' } });
		expect(bannerKeyFor(nearlyOut)).toBe(`billing-banner:credits_5:${NOV_5}`);
		expect(bannerKeyFor(view('pro', { paymentFailing: true, graceEndsAt: NOV_5 }))).toBe(`billing-banner:payment:${NOV_5}`);
	});

	it('states the plan, when it renews or ends, and whether it can be cancelled', () => {
		expect(planStatusFor(view('basic'))).toBe('Free');
		expect(planStatusFor(view('pro'))).toBe('Active');
		expect(planStatusFor(view('pro', { cancelAtPeriodEnd: true }))).toBe('Ending');
		expect(planStatusFor(view('pro', { paymentFailing: true }))).toBe('Payment failing');
		expect(planStatusFor(view('enterprise', { source: 'override' }))).toBe('Set by Estori');
		expect(renewalLineFor(view('pro'))).toBe('Renews on November 5');
		expect(renewalLineFor(view('pro', { cancelAtPeriodEnd: true }))).toBe('Ends on November 5');
		expect(renewalLineFor(view('premium', { pendingPlan: 'pro', pendingPlanAt: NOV_5 }))).toBe('Moves to Pro on November 5');
		expect(renewalLineFor(view('basic'))).toBe('AI credits renew on November 5');
		expect(canCancel(view('pro'))).toBe(true);
		expect(canCancel(view('pro', { cancelAtPeriodEnd: true }))).toBe(false);
		expect(canCancel(view('basic'))).toBe(false);
		expect(canCancel(view('enterprise', { source: 'override' }))).toBe(false);
	});

	it("shows the month's credits apart from extra credits, and never more used than the month had", () => {
		const premium = view('premium').credits!;
		expect(creditsSummaryFor(view('premium', { credits: { ...premium, granted: 5_000, used: 20_000, left: 90_000, purchasedLeft: 5_000, available: 110_000 } }))).toEqual({
			meterLabel: '20,000 of 105,000 AI credits used this month',
			meterPercent: (20_000 / 105_000) * 100,
			monthlyLeft: 85_000,
			extraLeft: 5_000,
			overrunNote: null,
		});
		const purchase = { credits: 30_000, left: 30_000, purchasedAt: NOV_5, expiresAt: NOV_5 };
		const covered = creditsSummaryFor(view('premium', { credits: { ...premium, used: 120_000, left: 10_000, purchasedLeft: 10_000, available: 130_000 }, purchases: [purchase] }));
		expect(covered).toMatchObject({ meterLabel: '100,000 of 100,000 AI credits used this month', meterPercent: 100, monthlyLeft: 0, extraLeft: 10_000 });
		expect(covered?.overrunNote).toBe('Your extra credits covered the other 20,000.');
		// No extra credits: a turn already running finishes past the month's credits.
		const pro = view('pro').credits!;
		expect(creditsSummaryFor(view('pro', { credits: { ...pro, used: 20_450, left: 0, available: 20_450 } }))?.overrunNote).toBe('450 more were used to finish turns that were already running.');
		const partly = creditsSummaryFor(view('premium', { credits: { ...premium, used: 120_000, left: 0, purchasedLeft: 0, available: 120_000 }, purchases: [{ ...purchase, left: 5_000 }] }));
		expect(partly?.overrunNote).toBe('20,000 more were used to finish turns that were already running, 5,000 of them from your extra credits.');
		expect(creditsSummaryFor(view('basic', { credits: null }))).toBeNull();
		expect(creditsSummaryFor(view('pro', { credits: { ...pro, pool: 0, left: 0, available: 0 } }))?.meterPercent).toBe(0);
	});

	it('lists each purchase with what is left and the day it expires, year included', () => {
		expect(purchaseLineFor({ credits: 10_000, left: 5_000, purchasedAt: Date.UTC(2026, 9, 19), expiresAt: Date.UTC(2027, 9, 19, 12) })).toBe('5,000 left, expire October 19, 2027');
	});

	it('keeps an extra-credits amount within what Stripe sells, in thousands', () => {
		expect(clampExtraCredits(4_000)).toBe(5_000);
		expect(clampExtraCredits(12_345)).toBe(12_000);
		expect(clampExtraCredits(2_000_000)).toBe(1_000_000);
		expect(clampExtraCredits(Number.NaN)).toBe(5_000);
	});

	it('confirms a purchase that landed even when an overrun used it all, and survives the trip to Stripe', () => {
		const before = view('premium');
		const bought = view('premium', { purchases: [{ credits: 5_000, left: 5_000, purchasedAt: NOV_5, expiresAt: NOV_5 }] });
		expect(isConfirmed('credits', before, bought)).toBe(true);
		const kept = readCheckoutBaseline(JSON.stringify(checkoutBaselineOf(bought)));
		expect(kept).toEqual({ credits: { purchasedLeft: 0 }, purchases: [{ purchasedAt: NOV_5 }] });
		expect(kept && isConfirmed('credits', kept, bought)).toBe(false);
		expect(readCheckoutBaseline('not json')).toBeNull();
		expect(readCheckoutBaseline(JSON.stringify({ credits: null, purchases: [{ purchasedAt: 'soon' }] }))).toBeNull();
		expect(readCheckoutBaseline(null)).toBeNull();
	});
});

const VISA: CardOnFile = { brand: 'visa', last4: '4242', expMonth: 8, expYear: 2028 };
const FAILING = { status: 'past_due', paymentFailing: true, graceEndsAt: NOV_5, card: VISA } as const;

describe('the card on file', () => {
	it('formats the card on file', () => {
		expect(cardLabelFor(VISA)).toBe('Visa ending 4242, expires 08/28');
		expect(cardLabelFor({ brand: 'mastercard', last4: '4444', expMonth: 12, expYear: 2031 })).toBe('Mastercard ending 4444, expires 12/31');
		expect(cardLabelFor({ brand: 'amex', last4: '0005', expMonth: 1, expYear: 2029 })).toBe('American Express ending 0005, expires 01/29');
	});

	it('calls a card of a brand it does not know a card', () => {
		expect(cardLabelFor({ brand: 'unknown', last4: '1111', expMonth: 3, expYear: 2027 })).toBe('Card ending 1111, expires 03/27');
		expect(cardLabelFor({ brand: 'someday_brand', last4: '1111', expMonth: 3, expYear: 2027 })).toBe('Card ending 1111, expires 03/27');
	});
});

describe('a failed payment on the billing page', () => {
	it('offers to pay with the card on file, and to update the card and pay', () => {
		expect(pastDueActionsFor(view('pro', FAILING))).toEqual({
			payNow: 'Pay now with Visa ending 4242',
			updateCard: { label: 'Update card and pay', to: '/settings/billing/card?mode=pay' },
		});
	});

	it('offers only a new card when there is none on file', () => {
		expect(pastDueActionsFor(view('pro', { ...FAILING, card: null }))?.payNow).toBeNull();
		expect(pastDueActionsFor(view('pro', { ...FAILING, card: { ...VISA, brand: 'unknown' } }))?.payNow).toBe('Pay now with card ending 4242');
	});

	it('offers nothing while payments are fine, outside the billing flag, or while Estori sets the plan', () => {
		expect(pastDueActionsFor(view('pro', { card: VISA }))).toBeNull();
		expect(pastDueActionsFor(view('pro', { ...FAILING, enabled: false }))).toBeNull();
		expect(pastDueActionsFor(view('enterprise', { ...FAILING, source: 'override' }))).toBeNull();
	});

	it('describes each payment result', () => {
		expect(describePaymentResult({ state: 'paid' })).toEqual({ tone: 'success', message: 'Your payment went through.' });
		expect(describePaymentResult({ state: 'nothing_due' })).toEqual({ tone: 'success', message: PAYMENT_WENT_THROUGH_MESSAGE });
		expect(describePaymentResult({ state: 'saved' })).toEqual({ tone: 'success', message: 'Your card is saved.' });
		expect(CARD_SAVED_MESSAGE).toBe('Your card is saved.');
		expect(describePaymentResult({ state: 'declined', message: 'Your card has insufficient funds.' })).toEqual({ tone: 'error', message: 'Your card has insufficient funds.' });
		expect(describePaymentResult({ state: 'declined', message: '' }).message).toBe("The payment didn't go through. Try another card.");
	});

	it('knows when the webhook has recorded a paid renewal, so the page stops asking', () => {
		expect(isRenewalPaid(view('pro', FAILING))).toBe(false);
		expect(isRenewalPaid(view('pro', { card: VISA }))).toBe(true);
	});
});

it('uses the paid annual end for cancellation and states annual upgrade prices without changing monthly credits', () => {
 const yearly = view('pro', { billingInterval: 'year', periodEnd: Date.parse('2027-10-05T10:00:00Z') });
 expect(confirmationFor(yearly, 'upgrade').body).toContain('$1,908 a year');
 expect(confirmationFor(yearly, 'upgrade').body).toContain('100,000 AI credits a month');
 expect(confirmationFor(yearly, 'cancel').body).toContain('October 5');
 const samePlanChange = { ...yearly, pendingPlan: 'pro' as const, pendingBillingInterval: 'month' as const, pendingPlanAt: yearly.periodEnd };
 expect(planChoicesFor(samePlanChange)[0].action).toBe('cancel-change');
 expect(renewalLineFor(samePlanChange)).toContain('monthly billing');
});


describe('confirming a selected recurring allowance', () => {
 it('explains an immediate increase and shows the full yearly price for a cadence change', () => {
  const current=view('pro',{billingInterval:'month',monthlyCredits:20000});
  const increase=configurationConfirmation(current,{plan:'pro',interval:'month',monthlyCredits:30000});
  expect(increase.body).toContain('30,000 AI credits a month now');
  expect(increase.body).toContain('$64 a month');
  const annual=configurationConfirmation(current,{plan:'pro',interval:'year',monthlyCredits:30000});
  expect(annual.body).toContain('$612 a year');
  expect(annual.body).toContain('current paid period stays unchanged');
 });
 it('waits for the exact current or scheduled credit amount rather than just the plan name', () => {
  const target={plan:'pro' as const,interval:'month' as const,monthlyCredits:30000};
  expect(configurationMatches(view('pro',{monthlyCredits:20000}),target)).toBe(false);
  expect(configurationMatches(view('pro',{monthlyCredits:30000}),target)).toBe(true);
  expect(configurationMatches(view('pro',{monthlyCredits:50000,pendingPlan:'pro',pendingBillingInterval:'month',pendingMonthlyCredits:30000}),target)).toBe(true);
  expect(configurationMatches(view('pro',{monthlyCredits:50000,pendingPlan:'pro',pendingBillingInterval:'year',pendingMonthlyCredits:30000}),target)).toBe(false);
 });
});
