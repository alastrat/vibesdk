/**
 * Stripe webhook: verifies the signature, then records paid Checkout
 * sessions, handles disputes of store payments and refreshes sellers' payout flags. Public and exempt from CSRF;
 * the signature is the authentication.
 */

import { createLogger } from '../../../logger';
import { SellerChargeService, StoreCheckoutService, StripeConnectService, TemplateService } from '../../../database';
import { STORE_ORDER_KIND } from '../../../../shared/types/store-payments';
import { disputeDepsFromEnv, recordStoreSession } from '../../../services/store-payments/wiring';
import { handleDisputeClosed, handleDisputeOpened, isStripeDispute } from '../../../services/store-payments/disputes';
import { accountFlags } from '../../../services/payments/stripe-client';
import { parseStripeEvent, verifyStripeSignature, type StripeEvent } from '../../../services/payments/webhook';
import { fulfillCheckoutSession, isCheckoutSession, isStripeAccount, isStripePayout } from '../../../services/payments/fulfill';
import { chargesForPayout } from '../../../services/payments/seller-costs';

const logger = createLogger('StripeWebhook');

export async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
    const secret = env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
        // Stripe retries a rejected delivery and eventually disables the endpoint, so make the missing secret visible.
        logger.error('Stripe webhook rejected: STRIPE_WEBHOOK_SECRET is not set');
        return new Response('Payments are not configured', { status: 400 });
    }
    const payload = await request.text();
    // Platform events and Connect events (sellers' accounts) come from two endpoints, each with its own secret.
    const secrets = [secret, env.STRIPE_CONNECT_WEBHOOK_SECRET].filter((value): value is string => typeof value === 'string' && value.length > 0);
    const now = Math.floor(Date.now() / 1000);
    let valid = false;
    for (const candidate of secrets) valid = valid || (await verifyStripeSignature(payload, request.headers.get('Stripe-Signature'), candidate, now));
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
        if (object.metadata?.kind === STORE_ORDER_KIND) {
            const stored = await recordStoreSession(env, object.id);
            logger.info('Store checkout session handled', { id: object.id, result: stored.result });
            return;
        }
        const listings = new TemplateService(env);
        const result = await fulfillCheckoutSession(
            {
                listingExists: async (listingId) => (await listings.getListing(listingId)) !== null,
                recordStripePurchase: (record) => listings.recordStripePurchase(record),
                sessionRecorded: (checkoutSessionId) => listings.hasCheckoutSession(checkoutSessionId),
            },
            object,
        );
        if (result === 'duplicate-purchase' || result === 'listing-missing') {
            // Stripe captured the payment but nothing was recorded; a retry cannot fix it, so answer 200 and flag it.
            logger.warn(`Checkout session paid but not recorded (${result}); refund the payment in the Stripe dashboard`, {
                sessionId: object.id,
                paymentIntentId: object.payment_intent,
                buyerUserId: object.metadata?.buyerUserId,
                amountCents: object.amount_total,
            });
            return;
        }
        logger.info('Checkout session handled', { id: object.id, result });
        return;
    }
    if (event.type === 'checkout.session.expired' && isCheckoutSession(object) && object.metadata?.kind === STORE_ORDER_KIND && object.metadata.checkoutId) {
        await new StoreCheckoutService(env).expire(object.metadata.checkoutId);
        return;
    }
    if ((event.type === 'charge.dispute.created' || event.type === 'charge.dispute.closed') && isStripeDispute(object)) {
        const deps = disputeDepsFromEnv(env, object);
        const result = event.type === 'charge.dispute.created' ? await handleDisputeOpened(deps, object) : await handleDisputeClosed(deps, object);
        logger.info('Dispute handled', { id: object.id, type: event.type, result });
        return;
    }
    if (event.type === 'payout.paid' && event.account && isStripePayout(object)) {
        const seller = await new StripeConnectService(env).getByAccountId(event.account);
        // Not one of Estori's sellers, or deleted since: nothing to charge.
        if (!seller) return;
        const charges = new SellerChargeService(env);
        for (const charge of chargesForPayout({ stripeAccountId: event.account, payoutId: object.id, amountCents: object.amount, arrivalDate: new Date(object.arrival_date * 1000) })) {
            await charges.add({ sellerUserId: seller.userId, ...charge, now: new Date() });
        }
        return;
    }
    if (event.type === 'account.updated' && isStripeAccount(object)) {
        await new StripeConnectService(env).updateFlags(object.id, accountFlags(object));
    }
}
