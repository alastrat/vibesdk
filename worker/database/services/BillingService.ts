/** D1 for billing: Stripe customers, subscription consents, subscriptions, handled events, sent notices and the lifetime store counter. */

import { and, eq, inArray, isNull, lt, lte, notExists, or, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { generateId } from '../../utils/idGenerator';
import { LIVE_SUBSCRIPTION_STATUSES, type BillingEventResult, type BillingNoticeKind } from '../../../shared/types/billing';
import type { PaidPlanId } from '../../../shared/types/plans';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BillingEventInput {
    event: { id: string; type: string; objectId: string | null; userId: string | null; result: BillingEventResult };
    row?: schema.SubscriptionRecord | null;
    purchase?: typeof schema.creditPurchases.$inferInsert | null;
    /** A purchase's refund to date; its removed credits are worked out in the write, from what the purchase has used by then. */
    refund?: { purchaseId: string; refundedCents: number } | null;
    /** The pool the account's open period takes with this event, such as a paid renewal ending a grace hold's pool of 0. */
    pool?: { periodKey: string; pool: number } | null;
    notices?: ReadonlyArray<{ key: string; kind: BillingNoticeKind }>;
    now: Date;
}

export interface BillingConsentInput {
    sessionId: string;
    userId: string;
    plan: PaidPlanId;
    termsVersion: string;
    consentText: string;
    now: Date;
}

export interface BillingConsent {
    userId: string;
    plan: PaidPlanId;
    termsVersion: string;
    consentText: string;
    createdAt: Date;
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

    /**
     * Points the account at `stripeCustomerId` in place of any customer it has, and logs the admin who did it in the same
     * batch. A customer already stored for another account breaks the unique key and writes nothing.
     */
    async linkCustomer(userId: string, stripeCustomerId: string, adminUserId: string, now: Date): Promise<void> {
        const previous = await this.customerOf(userId);
        await this.database.batch([
            this.database
                .insert(schema.billingCustomers)
                .values({ userId, stripeCustomerId, createdAt: now })
                .onConflictDoUpdate({ target: schema.billingCustomers.userId, set: { stripeCustomerId, createdAt: now } }),
            this.database.insert(schema.auditLogs).values({
                id: generateId(),
                userId: adminUserId,
                entityType: 'billing_customer',
                entityId: userId,
                action: 'link_test_customer',
                oldValues: { stripeCustomerId: previous },
                newValues: { stripeCustomerId },
                createdAt: now,
            }),
        ]);
    }

    /** Keeps the wording shown at a subscription Checkout session. Saving again replaces it, as applying a promotion code changes it; the session's account stays as first saved. */
    async recordConsent(input: BillingConsentInput): Promise<void> {
        const { sessionId, userId, plan, termsVersion, consentText, now } = input;
        await this.database
            .insert(schema.billingConsents)
            .values({ stripeCheckoutSessionId: sessionId, userId, plan, termsVersion, consentText, createdAt: now })
            .onConflictDoUpdate({ target: schema.billingConsents.stripeCheckoutSessionId, set: { plan, termsVersion, consentText, createdAt: now } });
    }

    async consentFor(sessionId: string): Promise<BillingConsent | null> {
        const consents = schema.billingConsents;
        const [found] = await this.database
            .select({ userId: consents.userId, plan: consents.plan, termsVersion: consents.termsVersion, consentText: consents.consentText, createdAt: consents.createdAt })
            .from(consents)
            .where(eq(consents.stripeCheckoutSessionId, sessionId))
            .limit(1);
        return found ?? null;
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
        const { event, row, purchase, refund, pool, notices = [], now } = input;
        if ((notices.length > 0 || pool) && event.userId === null) throw new Error(`Event ${event.id} has notices or a pool but no account`);

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
            const purchases = schema.creditPurchases;
            // The refunded share of what's unused at the write, so a settle landing after the caller read the purchase still counts.
            const unused = sql`(${purchases.credits} - ${purchases.used})`;
            rest.push(
                this.database
                    .update(purchases)
                    .set({
                        refundedCents: refund.refundedCents,
                        removedCredits: sql`MAX(${purchases.removedCredits}, MIN(${unused}, CAST((${unused} * ${refund.refundedCents}) / ${purchases.amountCents} AS INTEGER)))`,
                    })
                    .where(and(eq(purchases.id, refund.purchaseId), lt(purchases.refundedCents, refund.refundedCents))),
            );
        }
        if (pool && event.userId) {
            // A period with no row yet needs nothing (its first step stores the pool); a closed one keeps its pool.
            const periods = schema.creditPeriods;
            rest.push(
                this.database
                    .update(periods)
                    .set({ pool: pool.pool })
                    .where(and(eq(periods.userId, event.userId), eq(periods.periodKey, pool.periodKey), isNull(periods.closedAt))),
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

    /**
     * Accounts without a live subscription whose monthly credits renew on `dayStartMs`, with a verified email and no
     * renewal notice yet. Sign-up dates stored as text (the column's old default) renew on the 1st, as the period does.
     */
    async accountsRenewing(input: { dayStartMs: number; days: readonly number[]; userIds: readonly string[] | null; limit: number }): Promise<string[]> {
        if (input.days.length === 0 || input.userIds?.length === 0) return [];
        const users = schema.users;
        const dayStartSeconds = Math.floor(input.dayStartMs / 1000);
        const signupDay = sql`(CASE WHEN typeof(${users.createdAt}) = 'integer' THEN CAST(strftime('%d', ${users.createdAt}, 'unixepoch') AS INTEGER) ELSE 1 END)`;
        const rows = await this.database
            .select({ id: users.id })
            .from(users)
            .where(
                and(
                    eq(users.emailVerified, true),
                    isNull(users.deletedAt),
                    inArray(signupDay, [...input.days]),
                    sql`(typeof(${users.createdAt}) <> 'integer' OR ${users.createdAt} < ${dayStartSeconds})`,
                    notExists(
                        this.database
                            .select({ userId: schema.subscriptions.userId })
                            .from(schema.subscriptions)
                            .where(and(eq(schema.subscriptions.userId, users.id), inArray(schema.subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES]))),
                    ),
                    notExists(
                        this.database
                            .select({ userId: schema.billingNotices.userId })
                            .from(schema.billingNotices)
                            .where(and(eq(schema.billingNotices.userId, users.id), eq(schema.billingNotices.noticeKey, `credits_renewed:acct:${dayStartSeconds}`))),
                    ),
                    input.userIds ? inArray(users.id, [...input.userIds]) : undefined,
                ),
            )
            .limit(input.limit);
        return rows.map((row) => row.id);
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
     * Accounts that can be emailed and have no notice under `key`, in id order: not deleted, active and not suspended,
     * with a verified email, as `accountsRenewing` takes them.
     */
    async accountsWithoutNotice(key: string, limit: number): Promise<string[]> {
        const users = schema.users;
        const rows = await this.database
            .select({ id: users.id })
            .from(users)
            .where(
                and(
                    eq(users.emailVerified, true),
                    isNull(users.deletedAt),
                    eq(users.isActive, true),
                    eq(users.isSuspended, false),
                    notExists(
                        this.database
                            .select({ userId: schema.billingNotices.userId })
                            .from(schema.billingNotices)
                            .where(and(eq(schema.billingNotices.userId, users.id), eq(schema.billingNotices.noticeKey, key))),
                    ),
                ),
            )
            .orderBy(users.id)
            .limit(limit);
        return rows.map((row) => row.id);
    }

    /** The account's lifetime count of stores started; 0 for one that has started none. */
    async storesStartedOf(userId: string): Promise<number> {
        const counts = schema.accountStoreCounts;
        const [found] = await this.database.select({ started: counts.storesStarted }).from(counts).where(eq(counts.userId, userId)).limit(1);
        return found?.started ?? 0;
    }

    /** Takes back a claim whose email never went out, so a later run can claim and send it. */
    async releaseNotice(userId: string, key: string): Promise<void> {
        await this.database.delete(schema.billingNotices).where(and(eq(schema.billingNotices.userId, userId), eq(schema.billingNotices.noticeKey, key)));
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
