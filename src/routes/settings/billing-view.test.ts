import { describe, expect, it } from 'vitest';
import { PLAN_LIMITS, type BillingView, type PlanId } from '@/api-types';
import {
	bannerKeyFor,
	billingBannerFor,
	canCancel,
	checkoutBaselineOf,
	checkoutReturnOf,
	clampExtraCredits,
	confirmationFor,
	isConfirmed,
	paymentNoteFor,
	planChoicesFor,
	planStatusFor,
	purchaseLineFor,
	readCheckoutBaseline,
	renewalLineFor,
	requestedPlanOf,
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
		...overrides,
	};
}

const actions = (choices: ReturnType<typeof planChoicesFor>) => choices.map((choice) => `${choice.plan}:${choice.action}`);

describe('the billing page', () => {
	it('reads where the seller came back from, and the plan a link asked for', () => {
		expect(checkoutReturnOf('?checkout=success')).toBe('plan');
		expect(checkoutReturnOf('?credits=success')).toBe('credits');
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

	it('puts a failed payment, then a credit warning, in the banner, with the next step for the plan', () => {
		expect(billingBannerFor(view('pro', { status: 'past_due', paymentFailing: true, graceEndsAt: NOV_5 }))).toEqual({ tone: 'warning', message: "Your last payment didn't go through. Update your card by November 5 to keep Pro.", action: { kind: 'portal', label: 'Update card' } });
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
		expect(billingBannerFor(ended)).toEqual({ tone: 'warning', message: "Your last payment didn't go through, so your account is on Basic until it's paid. Update your card.", action: { kind: 'portal', label: 'Update card' } });
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
