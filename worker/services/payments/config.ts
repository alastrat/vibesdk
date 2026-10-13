/** Whether this deployment takes payments, and the user-facing payment messages. */

import { createStripeClient, type StripeClient } from './stripe-client';

export const PAYMENTS_NOT_CONFIGURED_MESSAGE = "Payments aren't set up on this deployment";
export const SELLER_NOT_ONBOARDED_MESSAGE = 'Connect Stripe to get paid before setting a price';
export const SELLER_NOT_READY_MESSAGE = "This seller can't receive payments right now";
export const STRIPE_REQUEST_FAILED_MESSAGE = "Stripe couldn't complete the request; try again";
export const ALREADY_OWNED_MESSAGE = 'You already own this site';
export const PAYMENT_INCOMPLETE_MESSAGE = "This payment isn't complete yet";

/** A Stripe client when the secret key is set; null on deployments without payments. */
export function stripeFromEnv(env: Env): StripeClient | null {
	return env.STRIPE_SECRET_KEY ? createStripeClient(env.STRIPE_SECRET_KEY) : null;
}
