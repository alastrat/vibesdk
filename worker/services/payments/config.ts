import { msg } from '../../../shared/i18n/translate';
/** Whether this deployment takes payments, and the user-facing payment messages. */

import { createStripeClient, type StripeClient } from './stripe-client';

export const PAYMENTS_NOT_CONFIGURED_MESSAGE = msg("Payments aren't set up on this deployment");
export const SELLER_NOT_ONBOARDED_MESSAGE = msg('Connect Stripe to get paid before setting a price');
export const SELLER_NOT_READY_MESSAGE = msg("This seller can't receive payments right now");
export const STRIPE_REQUEST_FAILED_MESSAGE = msg("Stripe couldn't complete the request; try again");
export const ALREADY_OWNED_MESSAGE = msg('You already own this site');
export const PAYMENT_INCOMPLETE_MESSAGE = msg("This payment isn't complete yet");

/** Which Stripe mode the secret key is for; null on deployments without payments. */
export function stripeModeOf(env: Env): 'test' | 'live' | null {
	const key = env.STRIPE_SECRET_KEY;
	if (!key) return null;
	return key.startsWith('sk_test_') || key.startsWith('rk_test_') ? 'test' : 'live';
}

/** A Stripe client when the secret key is set; null on deployments without payments. */
export function stripeFromEnv(env: Env): StripeClient | null {
	return env.STRIPE_SECRET_KEY ? createStripeClient(env.STRIPE_SECRET_KEY) : null;
}
