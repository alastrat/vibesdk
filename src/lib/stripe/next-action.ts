import type { InvoicePaymentResult } from '@/api-types';
import { loadWithin } from '@/lib/async';
import { loadStripe, type StripeJs, type StripeNextActionResult } from './stripe-js';

/** An invoice payment's answer once nothing more is asked of the seller. */
export type SettledPayment = Exclude<InvoicePaymentResult, { state: 'requires_action' }>;

export const NEXT_ACTION_FAILED_MESSAGE = "Your bank didn't confirm the payment. Try again, or update your card.";

type NextActionStripe = Pick<StripeJs, 'handleNextAction'>;

/** The intent after the bank's confirmation: paid when Stripe has taken the payment or is settling it. */
function settledBy(outcome: StripeNextActionResult): SettledPayment {
	if (outcome.error) return { state: 'declined', message: outcome.error.message || NEXT_ACTION_FAILED_MESSAGE };
	const { status } = outcome.paymentIntent;
	return status === 'succeeded' || status === 'processing' ? { state: 'paid' } : { state: 'declined', message: NEXT_ACTION_FAILED_MESSAGE };
}

/**
 * Finishes an answer that asks for the bank's confirmation by opening Stripe.js, with one new instance, and handing the
 * bank the answer's secret. Every other answer comes back as it is. A failure to open Stripe.js or to reach the bank
 * is a `declined` payment with a plain message, so the page always has a result to show.
 */
export async function settlePayment(result: InvoicePaymentResult, open: (publishableKey: string) => Promise<NextActionStripe> = loadStripe): Promise<SettledPayment> {
	if (result.state !== 'requires_action') return result;
	try {
		const stripe = await loadWithin(open(result.publishableKey));
		return settledBy(await stripe.handleNextAction({ clientSecret: result.clientSecret }));
	} catch {
		return { state: 'declined', message: NEXT_ACTION_FAILED_MESSAGE };
	}
}
