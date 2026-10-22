import { describe, expect, it } from 'vitest';
import { PLAN_YEARLY_PRICES_CENTS, PLAN_LIMITS, EXTRA_CREDITS, planPriceCents } from '../../../shared/types/plans';
import { renewalDisclosure, subscriptionConsentText } from '../../../shared/types/billing';
import { ENGLISH } from '../../../shared/i18n/translate';
import { subscriptionPeriod } from './periods';
import { planOrder, termsViewOf } from './checkout-session';

const start = Date.parse('2026-01-31T15:30:00Z');
const end = Date.parse('2027-01-31T15:30:00Z');
const subscription = { stripeSubscriptionId: 'sub_year', currentPeriodStart: new Date(start), currentPeriodEnd: new Date(end), billingInterval: 'year' as const };

describe('yearly subscriptions', () => {
	it('rounds yearly monthly rates to whole dollars, without changing monthly prices', () => {
		expect(PLAN_YEARLY_PRICES_CENTS).toEqual({ pro: 46800, premium: 190800 });
		expect(planPriceCents('pro', 'month')).toBe(4900);
		expect(planPriceCents('premium', 'year')).toBe(190800);
	});
	it('states the full yearly charge in consent, order and renewal disclosure', () => {
		expect(subscriptionConsentText('pro', null, ENGLISH, 'year')).toContain('$468 a year');
		expect(renewalDisclosure('premium', null, ENGLISH, 'year')).toContain('every year at $1,908');
		expect(planOrder('pro', ENGLISH, 'year')).toMatchObject({ priceCents: 46800, billingInterval: 'year', includes: expect.arrayContaining(['20,000 AI credits a month']) });
	});
	it('gives yearly subscriptions a fresh monthly credit period, retaining the original anniversary after short months', () => {
		const feb = subscriptionPeriod(subscription, Date.parse('2026-02-28T15:30:00Z'));
		expect(feb).toEqual({
			key: 'sub:sub_year:' + Date.parse('2026-02-28T15:30:00Z') / 1000,
			startMs: Date.parse('2026-02-28T15:30:00Z'),
			endMs: Date.parse('2026-03-31T15:30:00Z'),
		});
		expect(subscriptionPeriod(subscription, Date.parse('2026-03-31T15:30:00Z')).endMs).toBe(Date.parse('2026-04-30T15:30:00Z'));
		expect(subscriptionPeriod(subscription, end + 1000).endMs).toBe(end);
	});
});

it('refuses annual consent for a misconfigured monthly Stripe price', () => {
	const session = {
		id: 'cs_bad',
		mode: 'subscription' as const,
		url: null,
		payment_status: 'unpaid',
		metadata: { plan: 'pro', billing_interval: 'year' },
		amount_total: 4900,
		currency: 'usd',
		payment_intent: null,
		line_items: { data: [{ quantity: 1, price: { id: 'price_wrong', currency: 'usd', unit_amount: 4900, recurring: { interval: 'month', interval_count: 1 } } }] },
	};
	expect(() => termsViewOf('pro', session, ENGLISH)).toThrow('yearly price');
});

it('words repeating promotions in annual invoices while keeping the annual base discount', () => {
 const promotion = { duration: 'repeating' as const, durationInMonths: 4, discountedCents: 23400 };
 expect(subscriptionConsentText('pro', promotion, ENGLISH, 'year')).toContain('$234 a year for 1 year, then $468 a year');
 expect(subscriptionConsentText('pro', { ...promotion, durationInMonths: 18 }, ENGLISH, 'year')).toContain('a year for 2 years');
});


it('keeps every allowed yearly rate in whole monthly dollars with at least 20% savings', () => {
 for (const plan of ['pro','premium'] as const) {
  for(let credits=PLAN_LIMITS[plan].aiCredits;credits<=EXTRA_CREDITS.maxCredits;credits+=1000) {
   const monthly=planPriceCents(plan,'month',credits);
   const annual=planPriceCents(plan,'year',credits);
   expect(annual%1200).toBe(0);
   expect(annual).toBeLessThanOrEqual(monthly*12*0.8+0.00001);
   expect(monthly*12*0.8-annual).toBeLessThan(1200);
  }
 }
});
