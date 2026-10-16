import { describe, expect, it } from 'vitest';
import { SELLER_SETUP_MESSAGES, SELLER_TERMS_VERSION, isCurrentSellerTermsVersion, sellerSetupStep, type SellerReadiness } from './seller-setup';

const READY: SellerReadiness = {
	termsAccepted: true,
	connected: true,
	detailsSubmitted: true,
	cardPaymentsActive: true,
	transfersActive: true,
	payoutsEnabled: true,
};

describe('sellerSetupStep', () => {
	it('lets a fully set-up seller take payments', () => {
		expect(sellerSetupStep(READY)).toBeNull();
	});

	it('asks for the selling terms before anything at Stripe', () => {
		expect(sellerSetupStep({ ...READY, termsAccepted: false, connected: false })).toBe('accept-terms');
	});

	it("sends the seller back to Stripe until details, card payments and transfers are all in place", () => {
		for (const gap of ['connected', 'detailsSubmitted', 'cardPaymentsActive', 'transfersActive'] as const) {
			expect(sellerSetupStep({ ...READY, [gap]: false })).toBe('finish-stripe');
		}
	});

	it('asks for a verified bank account last', () => {
		expect(sellerSetupStep({ ...READY, payoutsEnabled: false })).toBe('bank-account');
	});

	it('names each step in plain words', () => {
		expect(SELLER_SETUP_MESSAGES).toEqual({
			'accept-terms': 'Accept the selling terms',
			'finish-stripe': 'Finish your Stripe setup',
			'bank-account': 'Add and verify a bank account',
		});
	});

	it('accepts only the current selling terms version', () => {
		expect(SELLER_TERMS_VERSION).toBe('2026-10-16');
		expect(isCurrentSellerTermsVersion('2026-10-16')).toBe(true);
		expect(isCurrentSellerTermsVersion('2026-10-13')).toBe(false);
		expect(isCurrentSellerTermsVersion(null)).toBe(false);
	});
});
