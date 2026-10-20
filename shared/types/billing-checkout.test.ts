import { describe, expect, it } from 'vitest';
import { renewalTermsPhrase, subscribeButtonText, subscriptionConsentText, type PromotionTerms } from './billing';
import { STRIPE_JS_URL } from './stripe';

const half = (duration: PromotionTerms['duration'], months: number | null = null): PromotionTerms => ({ duration, durationInMonths: months, discountedCents: 2450 });

describe('renewal wording', () => {
	it('says the plain price without a code', () => {
		expect(subscriptionConsentText('pro', null)).toBe('I agree to the Terms, and that Estori Pro renews at $49 a month until I cancel.');
		expect(subscribeButtonText('pro', null)).toBe('Subscribe: $49 a month');
		expect(subscribeButtonText('premium', null)).toBe('Subscribe: $199 a month');
	});

	it('names each coupon duration', () => {
		expect(renewalTermsPhrase('pro', half('once'))).toBe('$24.50 today, then $49 a month');
		expect(renewalTermsPhrase('pro', half('repeating', 3))).toBe('$24.50 a month for 3 months, then $49 a month');
		expect(renewalTermsPhrase('pro', half('repeating', 1))).toBe('$24.50 a month for 1 month, then $49 a month');
		expect(renewalTermsPhrase('pro', half('forever'))).toBe('$24.50 a month');
		expect(subscriptionConsentText('pro', half('once'))).toBe('I agree to the Terms, and that Estori Pro costs $24.50 today, then $49 a month, until I cancel.');
		expect(subscribeButtonText('pro', half('repeating', 3))).toBe('Subscribe: $24.50 a month for 3 months, then $49 a month');
	});

	it('handles a free first payment', () => {
		expect(renewalTermsPhrase('pro', { duration: 'once', durationInMonths: null, discountedCents: 0 })).toBe('$0 today, then $49 a month');
	});
});

describe('stripe.js', () => {
	it('builds the stripe.js url from the pinned version', () => {
		expect(STRIPE_JS_URL).toBe('https://js.stripe.com/dahlia/stripe.js');
	});
});
