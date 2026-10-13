/**
 * Stripe webhook: verifies the signature, then records paid Checkout
 * sessions and refreshes sellers' payout flags. Public and exempt from CSRF;
 * the signature is the authentication.
 */

import { createLogger } from '../../../logger';
import { StripeConnectService, TemplateService } from '../../../database';
import { accountFlags } from '../../../services/payments/stripe-client';
import { parseStripeEvent, verifyStripeSignature, type StripeEvent } from '../../../services/payments/webhook';
import { fulfillCheckoutSession, isCheckoutSession, isStripeAccount } from '../../../services/payments/fulfill';

const logger = createLogger('StripeWebhook');

export async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
    const secret = env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return new Response('Payments are not configured', { status: 400 });
    const payload = await request.text();
    const valid = await verifyStripeSignature(payload, request.headers.get('Stripe-Signature'), secret, Math.floor(Date.now() / 1000));
    if (!valid) return new Response('Invalid signature', { status: 400 });
    const event = parseStripeEvent(payload);
    if (!event) return new Response('Malformed event', { status: 400 });
    try {
        await dispatchStripeEvent(env, event);
    } catch (error) {
        logger.error('Stripe webhook handling failed', { type: event.type, id: event.id, error });
        return new Response('Webhook handling failed', { status: 500 });
    }
    return Response.json({ received: true });
}

async function dispatchStripeEvent(env: Env, event: StripeEvent): Promise<void> {
    const object = event.data.object;
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        if (!isCheckoutSession(object)) return;
        const listings = new TemplateService(env);
        const result = await fulfillCheckoutSession(
            {
                listingExists: async (listingId) => (await listings.getListing(listingId)) !== null,
                recordStripePurchase: (record) => listings.recordStripePurchase(record),
            },
            object,
        );
        logger.info('Checkout session handled', { id: object.id, result });
        return;
    }
    if (event.type === 'account.updated' && isStripeAccount(object)) {
        await new StripeConnectService(env).updateFlags(object.id, accountFlags(object));
    }
}
