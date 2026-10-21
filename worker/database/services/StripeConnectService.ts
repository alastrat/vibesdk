/** D1 reads and writes for sellers' Stripe Connect accounts. */

import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { isMissingAccountError, type SellerFlags } from '../../services/payments/stripe-client';
import type { PayoutInterval } from '../../../shared/types/store-payments';
import type { SellerLevel } from '../../../shared/types/seller-levels';
import { serverAnalytics } from '../../services/posthog/analytics';
import { stripeReady } from '../../services/posthog/commerce-events';

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

    async setPayoutSchedule(userId: string, interval: PayoutInterval, anchor: string): Promise<void> {
        await this.database
            .update(schema.stripeConnectAccounts)
            .set({ payoutInterval: interval, payoutAnchor: anchor, updatedAt: new Date() })
            .where(eq(schema.stripeConnectAccounts.userId, userId));
    }

    /** Stores Stripe's flags; the update that first makes the account ready sends `payments_ready`. Null for an unknown account. */
    async updateFlags(stripeAccountId: string, flags: SellerFlags): Promise<{ userId: string; becameReady: boolean } | null> {
        const before = await this.getByAccountId(stripeAccountId);
        await this.database
            .update(schema.stripeConnectAccounts)
            .set({ ...flags, updatedAt: new Date() })
            .where(eq(schema.stripeConnectAccounts.stripeAccountId, stripeAccountId));
        if (!before) return null;
        const becameReady = !stripeReady(before) && stripeReady(flags);
        if (becameReady) serverAnalytics(this.env).capture('payments_ready', before.userId, {});
        return { userId: before.userId, becameReady };
    }

    /**
     * Runs a Stripe call on the seller's stored account. When Stripe no longer has that account, its row is
     * deleted and the result is null, so the seller reads as not connected; other failures are rethrown.
     * The delete matches the account id too, so a row a concurrent onboarding just stored survives.
     */
    async forgetIfMissing<T>(
        stored: { userId: string; stripeAccountId: string },
        call: (stripeAccountId: string) => Promise<T>,
    ): Promise<T | null> {
        try {
            return await call(stored.stripeAccountId);
        } catch (error) {
            if (!isMissingAccountError(error)) throw error;
            await this.database
                .delete(schema.stripeConnectAccounts)
                .where(
                    and(
                        eq(schema.stripeConnectAccounts.userId, stored.userId),
                        eq(schema.stripeConnectAccounts.stripeAccountId, stored.stripeAccountId),
                    ),
                );
            return null;
        }
    }

    async saveLevel(userId: string, level: SellerLevel, payoutDelayDays: number): Promise<void> {
        await this.database.update(schema.stripeConnectAccounts).set({ sellerLevel: level, payoutDelayDays, updatedAt: new Date() }).where(eq(schema.stripeConnectAccounts.userId, userId));
    }

    /** Sellers whose payout delay Estori never set, such as accounts made before levels; the daily check syncs them. */
    async unsyncedSellerIds(): Promise<string[]> {
        const rows = await this.database.select({ id: schema.stripeConnectAccounts.userId }).from(schema.stripeConnectAccounts).where(isNull(schema.stripeConnectAccounts.payoutDelayDays)).limit(1000).all();
        return rows.map((row) => row.id);
    }
}
