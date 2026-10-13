/** D1 reads and writes for sellers' Stripe Connect accounts. */

import { eq } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import type { SellerFlags } from '../../services/payments/stripe-client';

export class StripeConnectService extends BaseService {
    async getByUser(userId: string): Promise<schema.StripeConnectAccount | null> {
        const row = await this.database
            .select()
            .from(schema.stripeConnectAccounts)
            .where(eq(schema.stripeConnectAccounts.userId, userId))
            .get();
        return row ?? null;
    }

    async getByAccountId(stripeAccountId: string): Promise<schema.StripeConnectAccount | null> {
        const row = await this.database
            .select()
            .from(schema.stripeConnectAccounts)
            .where(eq(schema.stripeConnectAccounts.stripeAccountId, stripeAccountId))
            .get();
        return row ?? null;
    }

    async create(input: { userId: string; stripeAccountId: string; flags: SellerFlags }): Promise<void> {
        const now = new Date();
        await this.database
            .insert(schema.stripeConnectAccounts)
            .values({ userId: input.userId, stripeAccountId: input.stripeAccountId, ...input.flags, createdAt: now, updatedAt: now });
    }

    async updateFlags(stripeAccountId: string, flags: SellerFlags): Promise<void> {
        await this.database
            .update(schema.stripeConnectAccounts)
            .set({ ...flags, updatedAt: new Date() })
            .where(eq(schema.stripeConnectAccounts.stripeAccountId, stripeAccountId));
    }
}
