/** API types for Stripe Connect onboarding. */

export interface StripeConnectStatusData {
    /** This deployment has Stripe keys. */
    configured: boolean;
    /** The user has started Stripe onboarding. */
    connected: boolean;
    detailsSubmitted: boolean;
    payoutsEnabled: boolean;
    /** Stripe can transfer sale proceeds to this seller; required to sell. */
    transfersActive: boolean;
}

export interface StripeLinkData {
    url: string;
}
