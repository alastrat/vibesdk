import { msg } from '../i18n/translate';
/** What a seller needs before their stores take payments, and the next step to show them. */

export const SELLER_TERMS_VERSION = '2026-10-16';

/** Where a seller finishes payments setup: the Payouts card on their profile. */
export const SELLER_SETUP_PATH = '/profile?tab=paid';

export const SELLER_SETUP_STEPS = ['accept-terms', 'finish-stripe', 'bank-account'] as const;
export type SellerSetupStep = (typeof SELLER_SETUP_STEPS)[number];

export const SELLER_SETUP_MESSAGES: Readonly<Record<SellerSetupStep, string>> = {
	'accept-terms': msg('Accept the selling terms'),
	'finish-stripe': msg('Finish your Stripe setup'),
	'bank-account': msg('Add and verify a bank account'),
};

export interface SellerReadiness {
	termsAccepted: boolean;
	/** The seller has a Stripe Connect account. */
	connected: boolean;
	detailsSubmitted: boolean;
	/** The seller can be the merchant of record; Estori never is for a store sale. */
	cardPaymentsActive: boolean;
	transfersActive: boolean;
	/** Needs a verified bank account, which Stripe debits to recover a negative balance. */
	payoutsEnabled: boolean;
}

/** The first step still missing, or null when the seller's stores can take payments. */
export function sellerSetupStep(readiness: SellerReadiness): SellerSetupStep | null {
	if (!readiness.termsAccepted) return 'accept-terms';
	if (!readiness.connected || !readiness.detailsSubmitted || !readiness.cardPaymentsActive || !readiness.transfersActive) return 'finish-stripe';
	if (!readiness.payoutsEnabled) return 'bank-account';
	return null;
}

export function isCurrentSellerTermsVersion(version: unknown): boolean {
	return version === SELLER_TERMS_VERSION;
}
