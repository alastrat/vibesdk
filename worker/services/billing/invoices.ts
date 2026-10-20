/** What billing shows of a Stripe invoice and of the card a subscription renews on, and the one way a default card is set. */

import type { CardOnFile, InvoiceView } from '../../../shared/types/billing';
import type { StripeClient, StripeInvoice, StripePaymentMethodRef, StripeSubscription } from '../payments/stripe-client';

/** The history lists this many invoices, newest first. */
export const HISTORY_LIMIT = 24;

/** Shown for an invoice whose lines carry no text. */
const FALLBACK_DESCRIPTION = 'Estori invoice';

/** The subscription an invoice bills, from its parent in the pinned API version; null for an invoice outside a subscription. */
export function invoiceSubscriptionId(invoice: StripeInvoice): string | null {
	const subscription = invoice.parent?.subscription_details?.subscription;
	return typeof subscription === 'string' ? subscription : null;
}

/** One history row; null for a draft, which Stripe hasn't finalized and the seller can't act on. */
export function invoiceView(invoice: StripeInvoice): InvoiceView | null {
	if (invoice.status === 'draft') return null;
	return {
		id: invoice.id,
		date: invoice.created * 1000,
		description: invoice.lines?.data[0]?.description ?? invoice.description ?? FALLBACK_DESCRIPTION,
		amountCents: invoice.status === 'paid' ? invoice.amount_paid : invoice.amount_due,
		currency: invoice.currency,
		status: invoice.status,
	};
}

/** The history rows of invoices Stripe listed, in its order. */
export function historyOf(invoices: readonly StripeInvoice[]): InvoiceView[] {
	return invoices.flatMap((invoice) => invoiceView(invoice) ?? []);
}

function paymentMethodId(ref: StripePaymentMethodRef | null | undefined): string | null {
	if (!ref) return null;
	return typeof ref === 'string' ? ref : ref.id;
}

/**
 * The payment method Stripe charges a customer's invoices with: the subscription's own default, else the customer's.
 * Subscription Checkout stores the card on the subscription, so the customer's default alone can be empty. Null with neither.
 */
export async function chargedPaymentMethod(
	stripe: Pick<StripeClient, 'retrieveCustomer'>,
	customerId: string,
	subscription: Pick<StripeSubscription, 'default_payment_method'> | null,
): Promise<string | null> {
	const own = paymentMethodId(subscription?.default_payment_method);
	if (own) return own;
	const customer = await stripe.retrieveCustomer(customerId);
	return paymentMethodId(customer.invoice_settings?.default_payment_method);
}

/**
 * The card Stripe charges, as the display fields it reports: the live subscription's default when `subscriptionId` names
 * one, else the customer's. Null when there is no card, or the payment method isn't one.
 */
export async function cardOnFile(
	stripe: Pick<StripeClient, 'retrieveCustomer' | 'retrieveSubscription' | 'retrievePaymentMethod'>,
	customerId: string,
	subscriptionId: string | null,
): Promise<CardOnFile | null> {
	const subscription = subscriptionId === null ? null : await stripe.retrieveSubscription(subscriptionId);
	const cardId = await chargedPaymentMethod(stripe, customerId, subscription);
	if (!cardId) return null;
	const { card } = await stripe.retrievePaymentMethod(cardId);
	return card && { brand: card.brand, last4: card.last4, expMonth: card.exp_month, expYear: card.exp_year };
}

/**
 * Makes `paymentMethodId` the card the customer's invoices are charged to, and the subscription's own when there is one.
 * Idempotent, so the seller's return and the webhook can both run it.
 */
export async function setDefaultCard(
	stripe: Pick<StripeClient, 'setDefaultPaymentMethod'>,
	customerId: string,
	subscriptionId: string | null,
	paymentMethodId: string,
): Promise<void> {
	await stripe.setDefaultPaymentMethod({ customerId, subscriptionId, paymentMethodId });
}
