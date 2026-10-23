import { DiscoverService, type DiscoverOrder } from '../../database/services/DiscoverService';
import { isStripeUrl, type StripeCheckoutSession, type StripeClient } from '../payments/stripe-client';
import type { DiscoverEntry } from '../../../shared/types/discover-catalog';
import type { DiscoverVersion } from '../../database/services/DiscoverService';
import type { StripeEvent } from '../payments/webhook';
import { isCheckoutSession } from '../payments/fulfill';

export const DISCOVER_PAYMENT_PURPOSE = 'discover_catalog';
export function verifiedCatalogPayment(order: DiscoverOrder, session: StripeCheckoutSession): boolean {
    const metadata = session.metadata;
    return session.mode === 'payment' && session.status === 'complete' && session.payment_status === 'paid'
        && !!session.payment_intent && order.status !== 'refunded'
        && metadata?.purpose === DISCOVER_PAYMENT_PURPOSE && metadata.orderId === order.id
        && metadata.buyerUserId === order.user_id && metadata.versionId === order.version_id
        && session.client_reference_id === order.user_id && session.amount_total === order.price_cents
        && session.currency === order.currency && (order.session_id === null || order.session_id === session.id);
}

/** Called only with a verified signed event or a session retrieved server-side from Stripe. */
export async function fulfillCatalogSession(service: DiscoverService, session: StripeCheckoutSession, expectedUserId?: string): Promise<boolean> {
    const id = session.metadata?.orderId;
    if (!id || session.metadata?.purpose !== DISCOVER_PAYMENT_PURPOSE) return false;
    const order = await service.order(id);
    if (!order || (expectedUserId !== undefined && order.user_id !== expectedUserId) || !verifiedCatalogPayment(order, session)) return false;
    const result = await service.recordPurchase(order, session.id, session.payment_intent!);
    if (result === 'duplicate') throw new Error(`Duplicate Discover payment requires refund reconciliation: order ${order.id}, payment ${session.payment_intent}`);
    return result === 'recorded';
}

export async function handleDiscoverPaymentEvent(env: Env, event: StripeEvent): Promise<boolean> {
    const object = event.data.object;
    if ((event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') && isCheckoutSession(object) && object.metadata?.purpose === DISCOVER_PAYMENT_PURPOSE) {
        const service = new DiscoverService(env.DB);
        // A refund can be delivered before a retried completion; acknowledge it without reopening the purchase.
        const order = object.metadata.orderId ? await service.order(object.metadata.orderId) : null;
        if (order?.status === 'refunded') return true;
        if (!(await fulfillCatalogSession(service, object)) && object.payment_status === 'paid') {
            throw new Error('Paid Discover checkout failed stored-order verification');
        }
        return true;
    }
    if (event.type === 'charge.refunded' && typeof object === 'object' && object !== null) {
        const charge = object as { payment_intent?: unknown; amount_refunded?: unknown; metadata?: Record<string, unknown> };
        if (typeof charge.payment_intent === 'string' && typeof charge.amount_refunded === 'number' && charge.amount_refunded > 0) {
            // Intent lookup also handles older charges whose metadata is absent. A partial refund revokes the source license.
            const orderId = charge.metadata?.purpose === DISCOVER_PAYMENT_PURPOSE && typeof charge.metadata.orderId === 'string' ? charge.metadata.orderId : null;
            await new DiscoverService(env.DB).revokePurchase(charge.payment_intent, orderId);
            return orderId !== null;
        }
    }
    return false;
}

/** One reservation per buyer/entry, retained until Stripe confirms expiry or completion. */
export async function startCatalogCheckout(
    service: DiscoverService,
    stripe: Pick<StripeClient, 'createCatalogCheckoutSession' | 'retrieveCheckoutSession'>,
    input: { entry: DiscoverEntry; version: DiscoverVersion; userId: string; email: string; returnUrl: string; nowMs: number },
): Promise<{ kind: 'checkout'; url: string } | { kind: 'owned' | 'processing' }> {
    for (let attempt = 0; attempt < 3; attempt++) {
        const order = await service.createOrder(crypto.randomUUID(),input.userId,input.version,input.nowMs,{
            productName: input.entry.title,buyerEmail: input.email,returnUrl: input.returnUrl,
        });
        if (!order) return { kind: 'owned' };
        const session = order.session_id ? await stripe.retrieveCheckoutSession(order.session_id) : await stripe.createCatalogCheckoutSession({
            orderId: order.id,productName: order.product_name,priceCents: order.price_cents,buyerUserId: order.user_id,buyerEmail: order.buyer_email,
            versionId: order.version_id,cancelUrl: order.return_url,successUrl: `${order.return_url}&session_id={CHECKOUT_SESSION_ID}`,nowMs: order.created_at,
        });
        await service.attachSession(order.id,session.id);
        if (session.status === 'expired') {
            await service.expireOrder(order.id,session.id);
            continue;
        }
        if (session.status === 'complete') {
            return { kind: await fulfillCatalogSession(service,session,input.userId) ? 'owned' : 'processing' };
        }
        if (session.status !== 'open' || !session.url || !isStripeUrl(session.url)) throw new Error('Stripe returned an unavailable catalog checkout');
        return { kind: 'checkout',url: session.url };
    }
    return { kind: 'processing' };
}
