/** API types for Stripe Connect onboarding. */

import type { SellerSetupStep } from '../../../../shared/types/seller-setup';
import type { PayoutInterval } from '../../../../shared/types/store-payments';

export interface StripeConnectStatusData {
    /** This deployment has Stripe keys. */
    configured: boolean;
    /** The user has started Stripe onboarding. */
    connected: boolean;
    detailsSubmitted: boolean;
    payoutsEnabled: boolean;
    /** Stripe can transfer sale proceeds to this seller; required to sell. */
    transfersActive: boolean;
    /** Stripe lets the seller be the merchant of record; store checkout requires it. */
    cardPaymentsActive: boolean;
    sellerTermsAccepted: boolean;
    /** The next step before the seller's stores take payments; null when they're ready. */
    setupStep: SellerSetupStep | null;
    payoutInterval: PayoutInterval;
    /** A weekday for weekly payouts, a day of the month for monthly ones, empty for daily. */
    payoutAnchor: string;
    /** Stripe's account and payout fees a month for each frequency, at the seller's last 30 days of sales; cents. */
    payoutCostEstimates: Record<PayoutInterval, number>;
}

export interface StripeLinkData {
    url: string;
}
