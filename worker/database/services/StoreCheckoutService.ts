/** D1 reads and writes for store checkouts. */

import { and, eq } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import type { PricedCart } from '../../../shared/types/store-payments';
import type { StoreCheckoutRecord } from '../../services/store-payments/store';

export class StoreCheckoutService extends BaseService {
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

    /** Only an open checkout expires; a completed one keeps its status when Stripe's expiry event arrives late. */
    async expire(checkoutId: string): Promise<void> {
        await this.database
            .update(schema.storeCheckouts)
            .set({ status: 'expired' })
            .where(and(eq(schema.storeCheckouts.id, checkoutId), eq(schema.storeCheckouts.status, 'open')));
    }

    async get(checkoutId: string): Promise<StoreCheckoutRecord | null> {
        const row = await this.database.select().from(schema.storeCheckouts).where(eq(schema.storeCheckouts.id, checkoutId)).get();
        if (!row) return null;
        const { stripeCheckoutSessionId: _sessionId, pricedCart, ...checkout } = row;
        const cart: PricedCart = JSON.parse(pricedCart);
        return { ...checkout, pricedCart: cart };
    }
}
