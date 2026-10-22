import { describe, expect, it } from 'vitest';
import { ENGLISH } from '../../../shared/i18n/translate';
import type { StripeCheckoutSession, StripeCoupon } from '../payments/stripe-client';
import { billingSessionOf, creditsOrder, planOrder, promotionTermsOf, sessionStateOf, termsViewOf, UnreadablePromotionError } from './checkout-session';

const SESSION: StripeCheckoutSession = { id: 'cs_1', url: null, payment_status: 'unpaid', status: 'open', client_reference_id: 'u1', metadata: null, amount_total: 4_900, currency: 'usd', payment_intent: null };

const coupon = (overrides: Partial<StripeCoupon> = {}): StripeCoupon => ({ id: 'half', duration: 'once', duration_in_months: null, ...overrides });

/** A session with a promotion code applied, as the billing expand list returns it. */
const viaPromotionCode = (value: StripeCoupon | string | null, amountTotal: number | null = 2_450): StripeCheckoutSession => ({
	...SESSION,
	amount_total: amountTotal,
	discounts: [{ promotion_code: { id: 'promo_1', promotion: { type: 'coupon', coupon: value } } }],
});

describe('the terms of a promotion code', () => {
	it('reads a once coupon from a promotion code', () => {
		expect(promotionTermsOf(viaPromotionCode(coupon()))).toEqual({ duration: 'once', durationInMonths: null, discountedCents: 2_450 });
	});

	it('reads a repeating coupon', () => {
		const session: StripeCheckoutSession = { ...SESSION, amount_total: 2_450, discounts: [{ coupon: coupon({ duration: 'repeating', duration_in_months: 3 }) }] };
		expect(promotionTermsOf(session)).toEqual({ duration: 'repeating', durationInMonths: 3, discountedCents: 2_450 });
	});

	it('reads a forever coupon, and the first discount when there are several', () => {
		const session: StripeCheckoutSession = { ...SESSION, amount_total: 2_450, discounts: [{ coupon: coupon({ duration: 'forever' }) }, { coupon: coupon({ id: 'ignored', duration: 'once' }) }] };
		expect(promotionTermsOf(session)).toEqual({ duration: 'forever', durationInMonths: null, discountedCents: 2_450 });
	});

	it('prefers the coupon on the discount when the promotion code names only an id', () => {
		const session: StripeCheckoutSession = { ...SESSION, amount_total: 0, discounts: [{ coupon: coupon(), promotion_code: 'promo_1' }] };
		expect(promotionTermsOf(session)).toEqual({ duration: 'once', durationInMonths: null, discountedCents: 0 });
	});

	it('no discount reads null', () => {
		expect(promotionTermsOf(SESSION)).toBeNull();
		expect(promotionTermsOf({ ...SESSION, discounts: null })).toBeNull();
		expect(promotionTermsOf({ ...SESSION, discounts: [] })).toBeNull();
	});

	it('never builds terms for a repeating coupon without months, naming the coupon', () => {
		const session = viaPromotionCode(coupon({ id: 'broken', duration: 'repeating', duration_in_months: null }));
		expect(() => promotionTermsOf(session)).toThrow(UnreadablePromotionError);
		expect(() => promotionTermsOf(session)).toThrow(expect.objectContaining({ couponId: 'broken' }));
	});

	it("refuses a coupon it only has the id of, and a discount whose amount isn't known", () => {
		expect(() => promotionTermsOf(viaPromotionCode('coupon_id_only'))).toThrow(expect.objectContaining({ couponId: 'coupon_id_only' }));
		expect(() => promotionTermsOf(viaPromotionCode(null))).toThrow(UnreadablePromotionError);
		expect(() => promotionTermsOf(viaPromotionCode(coupon({ id: 'no_total' }), null))).toThrow(expect.objectContaining({ couponId: 'no_total' }));
	});
});

describe('the state of a session', () => {
	it('a complete session that is paid, or needs no payment, is paid', () => {
		expect(sessionStateOf({ ...SESSION, status: 'complete', payment_status: 'paid' })).toBe('paid');
		expect(sessionStateOf({ ...SESSION, status: 'complete', payment_status: 'no_payment_required' })).toBe('paid');
	});

	it('a complete session still unpaid is processing', () => {
		expect(sessionStateOf({ ...SESSION, status: 'complete', payment_status: 'unpaid' })).toBe('processing');
	});

	it('an expired session is expired', () => {
		expect(sessionStateOf({ ...SESSION, status: 'expired' })).toBe('expired');
	});

	it('an open session, or one without a status, is open', () => {
		expect(sessionStateOf(SESSION)).toBe('open');
		expect(sessionStateOf({ ...SESSION, status: null })).toBe('open');
	});
});

describe('what a checkout session sells', () => {
	it('is a plan with its tag, a credits purchase with its tag, or nothing billing made', () => {
		expect(billingSessionOf({ ...SESSION, mode: 'subscription', metadata: { estori_user_id: 'u1', plan: 'premium' } })).toEqual({ kind: 'plan', plan: 'premium' });
		expect(billingSessionOf({ ...SESSION, mode: 'payment', metadata: { kind: 'credits', estori_user_id: 'u1', credits: '12000' } })).toEqual({ kind: 'credits' });
		expect(billingSessionOf({ ...SESSION, mode: 'subscription', metadata: { estori_user_id: 'u1', plan: 'enterprise' } })).toBeNull();
		expect(billingSessionOf({ ...SESSION, mode: 'setup', metadata: { kind: 'card', estori_user_id: 'u1' } })).toBeNull();
		// A paid-site purchase also carries the buyer's account id as its client reference, but no billing tag.
		expect(billingSessionOf({ ...SESSION, mode: 'payment', metadata: { checkout_id: 'chk_1' } })).toBeNull();
		expect(billingSessionOf(SESSION)).toBeNull();
	});

	it("shows a plan's price and what it includes from the plan table", () => {
		expect(planOrder('pro', ENGLISH)).toEqual({
			kind: 'plan',
			plan: 'pro',
			priceCents: 4_900,
			includes: ['20,000 AI credits a month', 'Up to 5 live stores', 'Your own domain on each live store', 'The supplier catalog'],
		});
		expect(planOrder('premium', ENGLISH)).toMatchObject({ priceCents: 19_900, includes: expect.arrayContaining(['100,000 AI credits a month', 'Up to 20 live stores']) });
	});

	it("shows a credits purchase's amount at the table's price", () => {
		expect(creditsOrder(5_000)).toEqual({ kind: 'credits', credits: 5_000, amountCents: 750 });
	});
});

describe('the terms of a plan checkout', () => {
	it('says the plain price without a code, and falls back to the plan price when the session has no total yet', () => {
		expect(termsViewOf('pro', SESSION, ENGLISH)).toEqual({
			consentText: 'I agree to the Terms, and that Estori Pro renews at $49 a month until I cancel.',
			buttonText: 'Subscribe: $49 a month',
			dueTodayCents: 4_900,
			disclosure: 'Pro renews every month at $49 until you cancel. Cancel any time in Estori; it ends at the end of the period.',
		});
		expect(termsViewOf('premium', { ...SESSION, amount_total: null }, ENGLISH).dueTodayCents).toBe(19_900);
	});

	it('follows the promotion code: the wording and what is due today', () => {
		expect(termsViewOf('pro', viaPromotionCode(coupon()), ENGLISH)).toEqual({
			consentText: 'I agree to the Terms, and that Estori Pro costs $24.50 today, then $49 a month, until I cancel.',
			buttonText: 'Subscribe: $24.50 today, then $49 a month',
			dueTodayCents: 2_450,
			disclosure: 'Pro costs $24.50 today, then renews every month at $49 until you cancel. Cancel any time in Estori; it ends at the end of the period.',
		});
		const repeating = viaPromotionCode(coupon({ duration: 'repeating', duration_in_months: 3 }));
		expect(termsViewOf('pro', repeating, ENGLISH).buttonText).toBe('Subscribe: $24.50 a month for 3 months, then $49 a month');
	});

	it('fails for a promotion it cannot state exactly, rather than show a wrong price', () => {
		expect(() => termsViewOf('pro', viaPromotionCode(coupon({ duration: 'repeating', duration_in_months: null })), ENGLISH)).toThrow(UnreadablePromotionError);
	});
});
