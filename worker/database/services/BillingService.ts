/** D1 for billing: Stripe customers, subscriptions, handled events, sent notices and the lifetime store counter. */

import { and, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { LIVE_SUBSCRIPTION_STATUSES, type BillingEventResult, type BillingNoticeKind } from '../../../shared/types/billing';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BillingEventInput {
    event: { id: string; type: string; objectId: string | null; userId: string | null; result: BillingEventResult };
    row?: schema.SubscriptionRecord | null;
    purchase?: typeof schema.creditPurchases.$inferInsert | null;
    refund?: { purchaseId: string; refundedCents: number; removedCredits: number } | null;
    notices?: ReadonlyArray<{ key: string; kind: BillingNoticeKind }>;
    now: Date;
}

export class BillingService extends BaseService {
    async customerOf(userId: string): Promise<string | null> {
        const [found] = await this.database
            .select({ id: schema.billingCustomers.stripeCustomerId })
            .from(schema.billingCustomers)
            .where(eq(schema.billingCustomers.userId, userId))
            .limit(1);
        return found?.id ?? null;
    }

    async userOfCustomer(stripeCustomerId: string): Promise<string | null> {
        const [found] = await this.database
            .select({ userId: schema.billingCustomers.userId })
            .from(schema.billingCustomers)
            .where(eq(schema.billingCustomers.stripeCustomerId, stripeCustomerId))
            .limit(1);
        return found?.userId ?? null;
    }

    /** Keeps the first customer an account gets and answers with the one kept, so two checkouts racing agree. */
    async saveCustomer(userId: string, stripeCustomerId: string, now: Date): Promise<string> {
        await this.database.insert(schema.billingCustomers).values({ userId, stripeCustomerId, createdAt: now }).onConflictDoNothing();
        const kept = await this.customerOf(userId);
        if (kept === null) throw new Error(`No Stripe customer stored for account ${userId}`);
        return kept;
    }

    async subscriptionOf(userId: string): Promise<schema.SubscriptionRecord | null> {
        const [found] = await this.database.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userId)).limit(1);
        return found ?? null;
    }

    /** Subscriptions to re-read from Stripe in case a webhook was missed: past due for over a day, or set to end and past their end. */
    async subscriptionsToRepair(nowMs: number): Promise<schema.SubscriptionRecord[]> {
        return this.database
            .select()
            .from(schema.subscriptions)
            .where(
                or(
                    and(eq(schema.subscriptions.status, 'past_due'), lte(schema.subscriptions.currentPeriodStart, new Date(nowMs - DAY_MS))),
                    and(
                        eq(schema.subscriptions.cancelAtPeriodEnd, true),
                        lte(schema.subscriptions.currentPeriodEnd, new Date(nowMs)),
                        inArray(schema.subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES]),
                    ),
                ),
            );
    }

    async eventSeen(eventId: string): Promise<boolean> {
        const [found] = await this.database
            .select({ id: schema.billingEvents.stripeEventId })
            .from(schema.billingEvents)
            .where(eq(schema.billingEvents.stripeEventId, eventId))
            .limit(1);
        return found !== undefined;
    }

    /**
     * Writes an event with its effects in one batch. A key that already exists anywhere in it (the event, the Checkout
     * session, a notice) rolls the whole batch back and throws; the caller decides what that means.
     */
    async recordEvent(input: BillingEventInput): Promise<void> {
        const { event, row, purchase, refund, notices = [], now } = input;
        if (notices.length > 0 && event.userId === null) throw new Error(`Event ${event.id} has notices but no account`);

        const rest: BatchItem<'sqlite'>[] = [];
        if (row) {
            rest.push(
                this.database
                    .insert(schema.subscriptions)
                    .values(row)
                    .onConflictDoUpdate({
                        target: schema.subscriptions.userId,
                        set: {
                            stripeSubscriptionId: row.stripeSubscriptionId,
                            status: row.status,
                            plan: row.plan,
                            currentPeriodStart: row.currentPeriodStart,
                            currentPeriodEnd: row.currentPeriodEnd,
                            cancelAtPeriodEnd: row.cancelAtPeriodEnd,
                            pendingPlan: row.pendingPlan,
                            pendingPlanAt: row.pendingPlanAt,
                            stripeScheduleId: row.stripeScheduleId,
                            stripeCreatedAt: row.stripeCreatedAt,
                            updatedAt: row.updatedAt,
                        },
                    }),
            );
        }
        if (purchase) rest.push(this.database.insert(schema.creditPurchases).values(purchase));
        if (refund) {
            rest.push(
                this.database
                    .update(schema.creditPurchases)
                    .set({ refundedCents: refund.refundedCents, removedCredits: refund.removedCredits })
                    .where(and(eq(schema.creditPurchases.id, refund.purchaseId), lt(schema.creditPurchases.refundedCents, refund.refundedCents))),
            );
        }
        for (const notice of notices) {
            rest.push(this.database.insert(schema.billingNotices).values({ userId: event.userId ?? '', noticeKey: notice.key, kind: notice.kind, sentAt: now }));
        }

        await this.database.batch([
            this.database.insert(schema.billingEvents).values({ stripeEventId: event.id, type: event.type, objectId: event.objectId, userId: event.userId, result: event.result, receivedAt: now }),
            ...rest,
        ]);
    }

    async sentNoticeKeys(userId: string, keys: readonly string[]): Promise<Set<string>> {
        if (keys.length === 0) return new Set();
        const found = await this.database
            .select({ key: schema.billingNotices.noticeKey })
            .from(schema.billingNotices)
            .where(and(eq(schema.billingNotices.userId, userId), inArray(schema.billingNotices.noticeKey, [...keys])));
        return new Set(found.map((entry) => entry.key));
    }

    /** True for the caller that records the notice first, the only one that should send it. */
    async claimNotice(userId: string, key: string, kind: BillingNoticeKind, now: Date): Promise<boolean> {
        const claimed = await this.database
            .insert(schema.billingNotices)
            .values({ userId, noticeKey: key, kind, sentAt: now })
            .onConflictDoNothing()
            .returning({ key: schema.billingNotices.noticeKey });
        return claimed.length > 0;
    }

    /**
     * Counts a new store against the account's lifetime total, and reserves its place only while the total is under
     * `cap` (null: no cap, the store is always reserved). One batch, so starts racing for the last place can't all win.
     */
    async reserveStore(userId: string, cap: number | null, now: Date): Promise<{ reserved: boolean; started: number }> {
        const counts = schema.accountStoreCounts;
        const [, taken, current] = await this.database.batch([
            this.database.insert(counts).values({ userId, storesStarted: 0, updatedAt: now }).onConflictDoNothing(),
            this.database
                .update(counts)
                .set({ storesStarted: sql`${counts.storesStarted} + 1`, updatedAt: now })
                .where(and(eq(counts.userId, userId), cap === null ? undefined : lt(counts.storesStarted, cap)))
                .returning({ started: counts.storesStarted }),
            this.database.select({ started: counts.storesStarted }).from(counts).where(eq(counts.userId, userId)),
        ]);
        const started = current[0]?.started;
        if (started === undefined) throw new Error(`No store count for account ${userId}`);
        return { reserved: taken.length > 0, started };
    }
}
