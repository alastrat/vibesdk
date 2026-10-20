/** D1 reads and writes for live stores: each store's address, its published version, and the seller's own domain. */

import { and, asc, count, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { isUniqueViolation } from './unique-violation';
import type { LiveStoreStatus, StoreDomainProvider, StoreDomainRecord, StoreDomainStatus } from '../../../shared/types/live-stores';

export interface LiveStoreRow {
    appId: string;
    slug: string;
    status: LiveStoreStatus;
    publishedCommit: string;
    publishedAt: Date;
}

/** What routing needs to serve a live store: which app, whether it's open, and whose sales they are. */
export interface LiveStoreTarget {
    appId: string;
    slug: string;
    status: LiveStoreStatus;
    sellerUserId: string;
}

export interface StoreDomainRow {
    hostname: string;
    appId: string;
    status: StoreDomainStatus;
    provider: StoreDomainProvider;
    providerId: string | null;
    records: StoreDomainRecord[];
    lastError: string | null;
    createdAt: Date;
    checkedAt: Date | null;
    verifiedAt: Date | null;
}

function isRecord(value: unknown): value is StoreDomainRecord {
    if (typeof value !== 'object' || value === null) return false;
    const record = value as Record<string, unknown>;
    return (record.type === 'CNAME' || record.type === 'TXT') && typeof record.name === 'string' && typeof record.value === 'string' && typeof record.purpose === 'string';
}

function recordsOf(text: string): StoreDomainRecord[] {
    try {
        const parsed: unknown = JSON.parse(text);
        return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
    } catch {
        return [];
    }
}

export class LiveStoreService extends BaseService {
    async getByApp(appId: string): Promise<LiveStoreRow | null> {
        const row = await this.database.select().from(schema.liveStores).where(eq(schema.liveStores.appId, appId)).get();
        return row ? { appId: row.appId, slug: row.slug, status: row.status, publishedCommit: row.publishedCommit, publishedAt: row.publishedAt } : null;
    }

    async slugHolder(slug: string): Promise<string | null> {
        const row = await this.database.select({ appId: schema.liveStores.appId }).from(schema.liveStores).where(eq(schema.liveStores.slug, slug)).get();
        return row?.appId ?? null;
    }

    /** Opens the store at `slug` with this commit; the first publish creates the record, later ones may move it. */
    async publish(input: { appId: string; slug: string; commit: string; now: Date }): Promise<'published' | 'slug-taken'> {
        const holder = await this.slugHolder(input.slug);
        if (holder && holder !== input.appId) return 'slug-taken';
        try {
            await this.database
                .insert(schema.liveStores)
                .values({ appId: input.appId, slug: input.slug, status: 'live', publishedCommit: input.commit, publishedAt: input.now, createdAt: input.now, updatedAt: input.now })
                .onConflictDoUpdate({
                    target: schema.liveStores.appId,
                    set: { slug: input.slug, status: 'live', publishedCommit: input.commit, publishedAt: input.now, updatedAt: input.now },
                });
        } catch (error) {
            // Another store took the slug between the check and the write.
            if (isUniqueViolation(error)) return 'slug-taken';
            throw error;
        }
        return 'published';
    }

    /** The account's stores that are live now; an offline store doesn't count. */
    async liveCountOf(userId: string): Promise<number> {
        const row = await this.database
            .select({ live: count() })
            .from(schema.liveStores)
            .innerJoin(schema.apps, eq(schema.apps.id, schema.liveStores.appId))
            .where(and(eq(schema.apps.userId, userId), eq(schema.liveStores.status, 'live')))
            .get();
        return row?.live ?? 0;
    }

    async setOffline(appId: string, now: Date): Promise<void> {
        await this.database.update(schema.liveStores).set({ status: 'offline', updatedAt: now }).where(eq(schema.liveStores.appId, appId));
    }

    /** The store at this slug, with its owner as the seller; null when no store has it or the app has no owner. */
    async storeForSlug(slug: string): Promise<LiveStoreTarget | null> {
        const row = await this.database
            .select({ appId: schema.liveStores.appId, slug: schema.liveStores.slug, status: schema.liveStores.status, sellerUserId: schema.apps.userId })
            .from(schema.liveStores)
            .innerJoin(schema.apps, eq(schema.apps.id, schema.liveStores.appId))
            .where(eq(schema.liveStores.slug, slug))
            .get();
        return row?.sellerUserId ? { appId: row.appId, slug: row.slug, status: row.status, sellerUserId: row.sellerUserId } : null;
    }

    /** The store an active custom domain serves; a pending or failed domain serves nothing. */
    async storeForHostname(hostname: string): Promise<LiveStoreTarget | null> {
        const row = await this.database
            .select({ appId: schema.liveStores.appId, slug: schema.liveStores.slug, status: schema.liveStores.status, sellerUserId: schema.apps.userId })
            .from(schema.storeDomains)
            .innerJoin(schema.liveStores, eq(schema.liveStores.appId, schema.storeDomains.appId))
            .innerJoin(schema.apps, eq(schema.apps.id, schema.storeDomains.appId))
            .where(and(eq(schema.storeDomains.hostname, hostname), eq(schema.storeDomains.status, 'active')))
            .get();
        return row?.sellerUserId ? { appId: row.appId, slug: row.slug, status: row.status, sellerUserId: row.sellerUserId } : null;
    }

    async domainOfApp(appId: string): Promise<StoreDomainRow | null> {
        const row = await this.database.select().from(schema.storeDomains).where(eq(schema.storeDomains.appId, appId)).get();
        return row ? { ...row, records: recordsOf(row.records) } : null;
    }

    /** The store's own domains in any state: a pending claim holds a place too. */
    async domainCountOf(appId: string): Promise<number> {
        const row = await this.database.select({ domains: count() }).from(schema.storeDomains).where(eq(schema.storeDomains.appId, appId)).get();
        return row?.domains ?? 0;
    }

    /** The claim on a hostname, in any state. */
    async domainByHostname(hostname: string): Promise<StoreDomainRow | null> {
        const row = await this.database.select().from(schema.storeDomains).where(eq(schema.storeDomains.hostname, hostname)).get();
        return row ? { ...row, records: recordsOf(row.records) } : null;
    }

    async addDomain(input: {
        appId: string;
        hostname: string;
        provider: StoreDomainProvider;
        providerId: string | null;
        records: StoreDomainRecord[];
        now: Date;
    }): Promise<'added' | 'hostname-taken' | 'store-has-domain'> {
        if (await this.domainOfApp(input.appId)) return 'store-has-domain';
        try {
            await this.database.insert(schema.storeDomains).values({
                hostname: input.hostname,
                appId: input.appId,
                status: 'pending',
                provider: input.provider,
                providerId: input.providerId,
                records: JSON.stringify(input.records),
                createdAt: input.now,
            });
        } catch (error) {
            if (!isUniqueViolation(error)) throw error;
            return (await this.domainOfApp(input.appId)) ? 'store-has-domain' : 'hostname-taken';
        }
        return 'added';
    }

    async updateDomain(
        hostname: string,
        update: { status: StoreDomainStatus; records: StoreDomainRecord[]; lastError: string | null; checkedAt: Date; verifiedAt?: Date | null },
    ): Promise<void> {
        await this.database
            .update(schema.storeDomains)
            .set({
                status: update.status,
                records: JSON.stringify(update.records),
                lastError: update.lastError,
                checkedAt: update.checkedAt,
                ...(update.verifiedAt !== undefined ? { verifiedAt: update.verifiedAt } : {}),
            })
            .where(eq(schema.storeDomains.hostname, hostname));
    }

    async removeDomain(appId: string): Promise<void> {
        await this.database.delete(schema.storeDomains).where(eq(schema.storeDomains.appId, appId));
    }

    /**
     * The domains the hourly sweep checks, least recently checked first: those waiting for DNS, and connected ones
     * with a warning or last checked before `connectedCheckedBefore`.
     */
    async domainsDue(connectedCheckedBefore: Date, limit = 50): Promise<StoreDomainRow[]> {
        const domains = schema.storeDomains;
        const rows = await this.database
            .select()
            .from(domains)
            .where(
                or(
                    eq(domains.status, 'pending'),
                    and(eq(domains.status, 'active'), or(isNotNull(domains.lastError), isNull(domains.checkedAt), lt(domains.checkedAt, connectedCheckedBefore))),
                ),
            )
            .orderBy(asc(schema.storeDomains.checkedAt))
            .limit(limit)
            .all();
        return rows.map((row) => ({ ...row, records: recordsOf(row.records) }));
    }
}
