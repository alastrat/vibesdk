/** D1 reads and writes for store checkouts. */

import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import type { PricedCart, StoreMode } from '../../../shared/types/store-payments';
import type { StoreCheckoutRecord } from '../../services/store-payments/store';
import type { Hold } from '../../services/store-payments/holds';

export class StoreCheckoutService extends BaseService {
    /** The weight of the seller's checkouts in this mode since `since`: paid ones, and ones a shopper may still pay. */
    async weeklyUsage(sellerUserId: string, mode: StoreMode, since: Date): Promise<number> {
        const row = await this.database
            .select({ used: sql<number>`COALESCE(sum(${schema.storeCheckouts.weightedCents}), 0)` })
            .from(schema.storeCheckouts)
            .where(
                and(
                    eq(schema.storeCheckouts.sellerUserId, sellerUserId),
                    eq(schema.storeCheckouts.mode, mode),
                    inArray(schema.storeCheckouts.status, ['creating', 'open', 'completed']),
                    gte(schema.storeCheckouts.createdAt, since),
                ),
            )
            .get();
        return row?.used ?? 0;
    }

    async create(checkout: StoreCheckoutRecord): Promise<void> {
        await this.database.insert(schema.storeCheckouts).values({ ...checkout, pricedCart: JSON.stringify(checkout.pricedCart) });
    }

    async attachSession(checkoutId: string, sessionId: string): Promise<void> {
        await this.database
            .update(schema.storeCheckouts)
            .set({ stripeCheckoutSessionId: sessionId, status: 'open' })
            .where(eq(schema.storeCheckouts.id, checkoutId));
    }

    async markFailed(checkoutId: string): Promise<void> {
        await this.database.update(schema.storeCheckouts).set({ status: 'failed' }).where(eq(schema.storeCheckouts.id, checkoutId));
    }

    /**
     * Only an open checkout expires; a completed one keeps its status when Stripe's expiry event arrives late. False when
     * the checkout wasn't open.
     */
    async expire(checkoutId: string): Promise<boolean> {
        const rows = await this.database
            .update(schema.storeCheckouts)
            .set({ status: 'expired' })
            .where(and(eq(schema.storeCheckouts.id, checkoutId), eq(schema.storeCheckouts.status, 'open')))
            .returning({ id: schema.storeCheckouts.id });
        return rows.length > 0;
    }

    /** The seller's open checkouts in this mode since `since`, oldest first: the unpaid ones holding room under the cap. */
    async openHolds(sellerUserId: string, mode: StoreMode, since: Date): Promise<Hold[]> {
        const rows = await this.database
            .select({ id: schema.storeCheckouts.id, sessionId: schema.storeCheckouts.stripeCheckoutSessionId, weightedCents: schema.storeCheckouts.weightedCents })
            .from(schema.storeCheckouts)
            .where(
                and(
                    eq(schema.storeCheckouts.sellerUserId, sellerUserId),
                    eq(schema.storeCheckouts.mode, mode),
                    eq(schema.storeCheckouts.status, 'open'),
                    gte(schema.storeCheckouts.createdAt, since),
                ),
            )
            .orderBy(asc(schema.storeCheckouts.createdAt))
            .all();
        return rows.flatMap((row) => (row.sessionId ? [{ id: row.id, sessionId: row.sessionId, weightedCents: row.weightedCents }] : []));
    }

    /**
     * Expires a checkout of this store that is still starting or open, for a replacement after a cart edit; null for any
     * other. The answer names its Stripe session, which the caller expires too.
     */
    async replaceOpen(checkoutId: string, appId: string): Promise<{ sessionId: string | null } | null> {
        const rows = await this.database
            .update(schema.storeCheckouts)
            .set({ status: 'expired' })
            .where(and(eq(schema.storeCheckouts.id, checkoutId), eq(schema.storeCheckouts.appId, appId), inArray(schema.storeCheckouts.status, ['creating', 'open'])))
            .returning({ sessionId: schema.storeCheckouts.stripeCheckoutSessionId });
        return rows[0] ? { sessionId: rows[0].sessionId } : null;
    }

    /** The Checkout session a checkout was paid through, once Stripe made one. */
    async sessionIdOf(checkoutId: string): Promise<string | null> {
        const row = await this.database.select({ sessionId: schema.storeCheckouts.stripeCheckoutSessionId }).from(schema.storeCheckouts).where(eq(schema.storeCheckouts.id, checkoutId)).get();
        return row?.sessionId ?? null;
    }

    async get(checkoutId: string): Promise<StoreCheckoutRecord | null> {
        const row = await this.database.select().from(schema.storeCheckouts).where(eq(schema.storeCheckouts.id, checkoutId)).get();
        if (!row) return null;
        const { stripeCheckoutSessionId: _sessionId, pricedCart, ...checkout } = row;
        const cart: PricedCart = JSON.parse(pricedCart);
        return { ...checkout, pricedCart: cart };
    }
}
