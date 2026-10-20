/**
 * D1 for the credit ledger. Each write is one batch, so one transaction: a step is charged only in the batch that
 * records its key, and settling compares and sets every row it changes, from one consistent read.
 */

import { and, asc, eq, inArray, isNull, lt, lte, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { BatchItem } from 'drizzle-orm/batch';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { generateId } from '../../utils/idGenerator';
import type { CreditUseSource } from '../../../shared/types/billing';
import type { StepUsage } from '../../services/billing/step-credits';
import { creditBalance, planSettlement, type CreditBalance, type LedgerPeriod, type PeriodState, type PurchaseState } from '../../services/billing/credit-ledger';

export interface RecordUseInput {
    userId: string;
    period: LedgerPeriod;
    pool: number;
    /** What the step was, so a retried write of the same step charges nothing. */
    useKey: string;
    credits: number;
    source: CreditUseSource;
    model: string;
    usage: StepUsage | null;
    now: Date;
}

export interface CreditGrantInput {
    userId: string;
    period: LedgerPeriod;
    pool: number;
    credits: number;
    adminUserId: string;
    reason: string;
    now: Date;
}

function periodState(row: schema.CreditPeriodRecord): PeriodState {
    return {
        key: row.periodKey,
        startMs: row.periodStart.getTime(),
        endMs: row.periodEnd.getTime(),
        pool: row.pool,
        granted: row.granted,
        used: row.used,
        settled: row.settled,
        closed: row.closedAt !== null,
    };
}

function purchaseState(row: schema.CreditPurchaseRecord): PurchaseState {
    return {
        id: row.id,
        credits: row.credits,
        used: row.used,
        removed: row.removedCredits,
        purchasedAtMs: row.purchasedAt.getTime(),
        expiresAtMs: row.expiresAt.getTime(),
    };
}

export class CreditLedgerService extends BaseService {
    /** Charges a step to its period unless its key was already recorded or the period has closed, and logs it either way. */
    async recordUse(input: RecordUseInput): Promise<PeriodState> {
        const periods = schema.creditPeriods;
        const uses = schema.creditUses;
        const { userId, period } = input;
        const [, , , rows] = await this.database.batch([
            this.ensurePeriod(userId, period, input.pool),
            this.database
                .update(periods)
                .set({ used: sql`${periods.used} + ${input.credits}`, pool: input.pool })
                .where(
                    and(
                        eq(periods.userId, userId),
                        eq(periods.periodKey, period.key),
                        isNull(periods.closedAt),
                        sql`NOT EXISTS (SELECT 1 FROM ${uses} WHERE ${uses.useKey} = ${input.useKey})`,
                    ),
                ),
            this.database
                .insert(uses)
                .values({
                    useKey: input.useKey,
                    userId,
                    periodKey: period.key,
                    credits: input.credits,
                    source: input.source,
                    model: input.model,
                    inputTokens: input.usage?.inputTokens ?? null,
                    outputTokens: input.usage?.outputTokens ?? null,
                    cacheReadTokens: input.usage?.cacheReadTokens ?? null,
                    cacheWriteTokens: input.usage?.cacheWriteTokens ?? null,
                    createdAt: input.now,
                })
                .onConflictDoNothing({ target: uses.useKey }),
            this.database.select().from(periods).where(and(eq(periods.userId, userId), eq(periods.periodKey, period.key))),
        ]);
        const [row] = rows;
        if (!row) throw new Error(`No credit period ${period.key} for account ${userId}`);
        return periodState(row);
    }

    /** The balance of `period` at `pool`, with every other unclosed period's overrun owed to purchases. */
    async readBalance(userId: string, period: LedgerPeriod, pool: number): Promise<CreditBalance> {
        const periods = schema.creditPeriods;
        const [currentRows, openRows, purchaseRows] = await this.database.batch([
            this.database.select().from(periods).where(and(eq(periods.userId, userId), eq(periods.periodKey, period.key))),
            this.database.select().from(periods).where(and(eq(periods.userId, userId), isNull(periods.closedAt), ne(periods.periodKey, period.key))),
            this.validPurchases(userId),
        ]);
        const [row] = currentRows;
        const current: PeriodState = row ? { ...periodState(row), pool } : { ...period, pool, granted: 0, used: 0, settled: 0, closed: false };
        return creditBalance({ current, open: openRows.map(periodState), purchases: purchaseRows.map(purchaseState) });
    }

    /**
     * Takes the account's unsettled overruns from its purchases and closes ended periods. Purchases past their expiry but
     * not yet marked expired still pay for what was used before they went, so run this before `expirePurchases`.
     * 'raced' means another run or a refund wrote first and this one changed nothing.
     */
    async settle(userId: string, nowMs: number): Promise<'settled' | 'nothing' | 'raced'> {
        const periods = schema.creditPeriods;
        const purchases = schema.creditPurchases;
        const [periodRows, purchaseRows] = await this.database.batch([
            this.database.select().from(periods).where(and(eq(periods.userId, userId), isNull(periods.closedAt))),
            this.validPurchases(userId),
        ]);
        const plan = planSettlement({ periods: periodRows.map(periodState), purchases: purchaseRows.map(purchaseState), nowMs });

        const unrefunded = this.noRemovalsSince(plan.purchases.map((entry) => entry.id), purchaseRows);
        const now = new Date(nowMs);
        const writes = [
            ...plan.purchases.map((entry) =>
                this.database
                    .update(purchases)
                    .set({ used: entry.usedAfter })
                    .where(and(eq(purchases.id, entry.id), eq(purchases.used, entry.usedBefore), unrefunded)),
            ),
            ...plan.periods.map((entry) =>
                this.database
                    .update(periods)
                    .set({
                        settled: entry.settledAfter,
                        forgiven: sql`${periods.forgiven} + ${entry.forgiven}`,
                        ...(entry.close ? { closedAt: now } : {}),
                    })
                    .where(
                        and(
                            eq(periods.userId, userId),
                            eq(periods.periodKey, entry.key),
                            eq(periods.settled, entry.settledBefore),
                            isNull(periods.closedAt),
                            unrefunded,
                        ),
                    ),
            ),
        ];
        const [first, ...rest] = writes;
        if (first === undefined) return 'nothing';
        const results = await this.database.batch([first, ...rest]);
        const changed = results.filter((result) => result.meta.changes === 1).length;
        if (changed === results.length) return 'settled';
        if (changed > 0) this.logger.error('Credit settlement wrote only part of its plan', { userId, changed, planned: results.length, plan });
        return 'raced';
    }

    async addGrant(input: CreditGrantInput): Promise<void> {
        const periods = schema.creditPeriods;
        const { userId, period, credits } = input;
        await this.database.batch([
            this.database.insert(schema.creditGrants).values({
                id: generateId(),
                userId,
                credits,
                periodKey: period.key,
                adminUserId: input.adminUserId,
                reason: input.reason,
                createdAt: input.now,
            }),
            this.ensurePeriod(userId, period, input.pool),
            this.database
                .update(periods)
                .set({ granted: sql`${periods.granted} + ${credits}` })
                .where(and(eq(periods.userId, userId), eq(periods.periodKey, period.key))),
            this.database.insert(schema.auditLogs).values({
                id: generateId(),
                userId: input.adminUserId,
                entityType: 'credit_grant',
                entityId: userId,
                action: 'credit_grant',
                newValues: { credits, periodKey: period.key, reason: input.reason },
                createdAt: input.now,
            }),
        ]);
    }

    async grantsOf(userId: string, periodKey: string): Promise<schema.CreditGrantRecord[]> {
        const grants = schema.creditGrants;
        return this.database
            .select()
            .from(grants)
            .where(and(eq(grants.userId, userId), eq(grants.periodKey, periodKey)))
            .orderBy(asc(grants.createdAt), asc(grants.id));
    }

    /** The account's purchases not yet expired, oldest first. */
    async purchasesOf(userId: string): Promise<schema.CreditPurchaseRecord[]> {
        return this.validPurchases(userId);
    }

    async purchaseByPaymentIntent(paymentIntentId: string): Promise<schema.CreditPurchaseRecord | null> {
        const [found] = await this.database
            .select()
            .from(schema.creditPurchases)
            .where(eq(schema.creditPurchases.stripePaymentIntentId, paymentIntentId))
            .limit(1);
        return found ?? null;
    }

    /** Accounts with a period that has ended but isn't closed, or a purchase past its expiry but not yet expired. */
    async usersToSettle(nowMs: number, limit: number): Promise<string[]> {
        const periods = schema.creditPeriods;
        const purchases = schema.creditPurchases;
        const now = new Date(nowMs);
        const rows = await this.database
            .select({ userId: periods.userId })
            .from(periods)
            .where(and(isNull(periods.closedAt), lte(periods.periodEnd, now)))
            .union(
                this.database
                    .select({ userId: purchases.userId })
                    .from(purchases)
                    .where(and(isNull(purchases.expiredAt), lte(purchases.expiresAt, now))),
            )
            .limit(limit);
        return rows.map((row) => row.userId);
    }

    /** Marks the account's purchases past their expiry as expired, and answers how many. */
    async expirePurchases(userId: string, nowMs: number): Promise<number> {
        const purchases = schema.creditPurchases;
        const now = new Date(nowMs);
        const expired = await this.database
            .update(purchases)
            .set({ expiredAt: now })
            .where(and(eq(purchases.userId, userId), lte(purchases.expiresAt, now), isNull(purchases.expiredAt)))
            .returning({ id: purchases.id });
        return expired.length;
    }

    /** Drops the usage log older than `beforeMs`. */
    async pruneUses(beforeMs: number): Promise<void> {
        await this.database.delete(schema.creditUses).where(lt(schema.creditUses.createdAt, new Date(beforeMs)));
    }

    private ensurePeriod(userId: string, period: LedgerPeriod, pool: number): BatchItem<'sqlite'> {
        return this.database
            .insert(schema.creditPeriods)
            .values({ userId, periodKey: period.key, periodStart: new Date(period.startMs), periodEnd: new Date(period.endMs), pool })
            .onConflictDoNothing();
    }

    /**
     * Holds while nothing was removed from the purchases a settlement takes from since `seen` was read. Settling never
     * changes removed credits and refunds only add to them, so an unchanged sum means no refund landed in between.
     */
    private noRemovalsSince(ids: readonly string[], seen: readonly schema.CreditPurchaseRecord[]): SQL | undefined {
        if (ids.length === 0) return undefined;
        const removedSeen = seen.filter((row) => ids.includes(row.id)).reduce((sum, row) => sum + row.removedCredits, 0);
        const check = alias(schema.creditPurchases, 'removal_check');
        return sql`(SELECT COALESCE(SUM(${check.removedCredits}), 0) FROM ${schema.creditPurchases} AS ${check} WHERE ${inArray(check.id, [...ids])}) = ${removedSeen}`;
    }

    private validPurchases(userId: string) {
        const purchases = schema.creditPurchases;
        return this.database
            .select()
            .from(purchases)
            .where(and(eq(purchases.userId, userId), isNull(purchases.expiredAt)))
            .orderBy(asc(purchases.purchasedAt), asc(purchases.id));
    }
}
