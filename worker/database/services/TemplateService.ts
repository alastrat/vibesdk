/**
 * D1 reads and writes for paid listings, their versions and purchases. A
 * listing belongs to one app, which supplies its title and category.
 * Decisions live in services/templates/catalog.ts and reuse.ts; this service
 * only moves rows.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { generateId } from '../../utils/idGenerator';
import type { TemplateListingStatus } from '../../../shared/types/templates';

export interface ListingVersionRow {
    listing: schema.Template;
    version: schema.TemplateVersion;
}

export interface PendingVersionRow extends ListingVersionRow {
    appTitle: string;
    creatorName: string | null;
    creatorEmail: string | null;
}

export interface StripePurchaseRecord {
    listingId: string;
    sourceAppId: string;
    versionId: string | null;
    userId: string;
    priceCents: number;
    platformFeeCents: number;
    sellerAmountCents: number;
    currency: string;
    checkoutSessionId: string;
    paymentIntentId: string | null;
    sellerStripeAccountId: string;
}

export interface SaleRow {
    purchaseId: string;
    appId: string | null;
    /** Null once the site has been deleted. */
    appTitle: string | null;
    buyerEmail: string | null;
    priceCents: number;
    platformFeeCents: number | null;
    createdAt: Date | null;
}

export interface CreatorListingRow {
    listing: schema.Template;
    appTitle: string;
    buyerCount: number;
    grossCents: number;
    feeCents: number;
    earningsCents: number;
    /** Newest first. */
    versions: schema.TemplateVersion[];
}

const buyerCountSql = sql<number>`(select count(*) from template_purchases as purchase where purchase.template_id = ${schema.templates.id})`;

export class TemplateService extends BaseService {
    async getListing(listingId: string): Promise<schema.Template | null> {
        const row = await this.database.select().from(schema.templates).where(eq(schema.templates.id, listingId)).get();
        return row ?? null;
    }

    async getListingByApp(appId: string): Promise<schema.Template | null> {
        const row = await this.database.select().from(schema.templates).where(eq(schema.templates.sourceAppId, appId)).get();
        return row ?? null;
    }

    /** Create an unlisted listing for an app; it is listed once its first version is stored. */
    async createListing(input: { sourceAppId: string; creatorUserId: string }): Promise<string> {
        const id = generateId();
        const now = new Date();
        await this.database.insert(schema.templates).values({
            id,
            sourceAppId: input.sourceAppId,
            creatorUserId: input.creatorUserId,
            status: 'unlisted',
            createdAt: now,
            updatedAt: now,
        });
        return id;
    }

    /** List a listing, or unlist it and withdraw any version still in review. */
    async setListingStatus(listingId: string, status: TemplateListingStatus): Promise<void> {
        const update = this.database
            .update(schema.templates)
            .set({ status, updatedAt: new Date() })
            .where(eq(schema.templates.id, listingId));
        if (status === 'listed') {
            await update;
            return;
        }
        const withdraw = this.database
            .update(schema.templateVersions)
            .set({ status: 'withdrawn' })
            .where(and(eq(schema.templateVersions.templateId, listingId), eq(schema.templateVersions.status, 'pending')));
        await this.database.batch([update, withdraw]);
    }

    async getVersion(versionId: string): Promise<schema.TemplateVersion | null> {
        const row = await this.database
            .select()
            .from(schema.templateVersions)
            .where(eq(schema.templateVersions.id, versionId))
            .get();
        return row ?? null;
    }

    /** Versions of a listing, newest first. */
    async listVersions(listingId: string): Promise<schema.TemplateVersion[]> {
        return this.database
            .select()
            .from(schema.templateVersions)
            .where(eq(schema.templateVersions.templateId, listingId))
            .orderBy(desc(schema.templateVersions.version))
            .all();
    }

    async getPendingVersion(listingId: string): Promise<schema.TemplateVersion | null> {
        const row = await this.database
            .select()
            .from(schema.templateVersions)
            .where(and(eq(schema.templateVersions.templateId, listingId), eq(schema.templateVersions.status, 'pending')))
            .get();
        return row ?? null;
    }

    async nextVersionNumber(listingId: string): Promise<number> {
        const row = await this.database
            .select({ latest: sql<number | null>`max(${schema.templateVersions.version})` })
            .from(schema.templateVersions)
            .where(eq(schema.templateVersions.templateId, listingId))
            .get();
        return (row?.latest ?? 0) + 1;
    }

    async insertVersion(version: schema.NewTemplateVersion): Promise<void> {
        await this.database.insert(schema.templateVersions).values(version);
    }

    async countBuyers(listingId: string): Promise<number> {
        const row = await this.database
            .select({ count: sql<number>`count(*)` })
            .from(schema.templatePurchases)
            .where(eq(schema.templatePurchases.templateId, listingId))
            .get();
        return row?.count ?? 0;
    }

    async listByCreator(userId: string): Promise<CreatorListingRow[]> {
        const listings = await this.database
            .select({
                listing: schema.templates,
                appTitle: schema.apps.title,
                buyerCount: buyerCountSql,
                grossCents: sql<number>`(select coalesce(sum(purchase.price_cents), 0) from template_purchases as purchase where purchase.template_id = ${schema.templates.id} and purchase.provider = 'stripe')`,
                feeCents: sql<number>`(select coalesce(sum(purchase.platform_fee_cents), 0) from template_purchases as purchase where purchase.template_id = ${schema.templates.id} and purchase.provider = 'stripe')`,
                earningsCents: sql<number>`(select coalesce(sum(purchase.seller_amount_cents), 0) from template_purchases as purchase where purchase.template_id = ${schema.templates.id} and purchase.provider = 'stripe')`,
            })
            .from(schema.templates)
            .innerJoin(schema.apps, eq(schema.apps.id, schema.templates.sourceAppId))
            .where(eq(schema.templates.creatorUserId, userId))
            .orderBy(desc(schema.templates.createdAt))
            .all();
        if (listings.length === 0) return [];
        const versions = await this.database
            .select()
            .from(schema.templateVersions)
            .where(inArray(schema.templateVersions.templateId, listings.map((row) => row.listing.id)))
            .orderBy(desc(schema.templateVersions.version))
            .all();
        return listings.map((row) => ({
            ...row,
            versions: versions.filter((version) => version.templateId === row.listing.id),
        }));
    }

    /** Versions waiting for review, oldest first. */
    async listPending(): Promise<PendingVersionRow[]> {
        return this.database
            .select({
                listing: schema.templates,
                version: schema.templateVersions,
                appTitle: schema.apps.title,
                creatorName: schema.users.displayName,
                creatorEmail: schema.users.email,
            })
            .from(schema.templateVersions)
            .innerJoin(schema.templates, eq(schema.templates.id, schema.templateVersions.templateId))
            .innerJoin(schema.apps, eq(schema.apps.id, schema.templates.sourceAppId))
            .leftJoin(schema.users, eq(schema.users.id, schema.templates.creatorUserId))
            .where(eq(schema.templateVersions.status, 'pending'))
            .orderBy(schema.templateVersions.createdAt)
            .limit(100)
            .all();
    }

    async getVersionWithListing(versionId: string): Promise<ListingVersionRow | null> {
        const row = await this.database
            .select({ listing: schema.templates, version: schema.templateVersions })
            .from(schema.templateVersions)
            .innerJoin(schema.templates, eq(schema.templates.id, schema.templateVersions.templateId))
            .where(eq(schema.templateVersions.id, versionId))
            .get();
        return row ?? null;
    }

    /**
     * Approve a version: it becomes the listing's current version and its
     * price the listing's price, and the previous approved version is
     * superseded. Returns false when the version was no longer pending.
     */
    async approveVersion(input: {
        listingId: string;
        versionId: string;
        supersedeVersionId: string | null;
        reviewerId: string;
    }): Promise<boolean> {
        const now = new Date();
        // Evaluated inside the batch, so the follow-up statements only apply
        // when the approval above them took effect.
        const nowApproved = sql`exists (select 1 from template_versions as approved_version where approved_version.id = ${input.versionId} and approved_version.status = 'approved')`;
        const approve = this.database
            .update(schema.templateVersions)
            .set({ status: 'approved', reviewedBy: input.reviewerId, reviewedAt: now })
            .where(and(eq(schema.templateVersions.id, input.versionId), eq(schema.templateVersions.status, 'pending')))
            .returning({ id: schema.templateVersions.id });
        const publish = this.database
            .update(schema.templates)
            .set({
                currentVersionId: input.versionId,
                priceCents: sql`(select approved_price.price_cents from template_versions as approved_price where approved_price.id = ${input.versionId})`,
                updatedAt: now,
            })
            .where(and(eq(schema.templates.id, input.listingId), nowApproved));
        if (input.supersedeVersionId) {
            const supersede = this.database
                .update(schema.templateVersions)
                .set({ status: 'superseded' })
                .where(and(
                    eq(schema.templateVersions.id, input.supersedeVersionId),
                    eq(schema.templateVersions.status, 'approved'),
                    nowApproved,
                ));
            const [approved] = await this.database.batch([approve, supersede, publish]);
            return approved.length > 0;
        }
        const [approved] = await this.database.batch([approve, publish]);
        return approved.length > 0;
    }

    /** Returns false when the version was no longer pending. */
    async rejectVersion(versionId: string, reviewerId: string, reason: string): Promise<boolean> {
        const changed = await this.database
            .update(schema.templateVersions)
            .set({ status: 'rejected', reviewedBy: reviewerId, reviewedAt: new Date(), rejectionReason: reason })
            .where(and(eq(schema.templateVersions.id, versionId), eq(schema.templateVersions.status, 'pending')))
            .returning({ id: schema.templateVersions.id });
        return changed.length > 0;
    }

    /** Returns false when the version was no longer pending. */
    async withdrawVersion(versionId: string): Promise<boolean> {
        const changed = await this.database
            .update(schema.templateVersions)
            .set({ status: 'withdrawn' })
            .where(and(eq(schema.templateVersions.id, versionId), eq(schema.templateVersions.status, 'pending')))
            .returning({ id: schema.templateVersions.id });
        return changed.length > 0;
    }

    async hasPurchase(listingId: string, userId: string): Promise<boolean> {
        const row = await this.database
            .select({ id: schema.templatePurchases.id })
            .from(schema.templatePurchases)
            .where(and(eq(schema.templatePurchases.templateId, listingId), eq(schema.templatePurchases.userId, userId)))
            .get();
        return row !== undefined;
    }

    async hasCheckoutSession(checkoutSessionId: string): Promise<boolean> {
        const row = await this.database
            .select({ id: schema.templatePurchases.id })
            .from(schema.templatePurchases)
            .where(eq(schema.templatePurchases.stripeCheckoutSessionId, checkoutSessionId))
            .get();
        return row !== undefined;
    }

    /** Record a paid Stripe Checkout session; false when this session or this buyer's purchase already exists. */
    async recordStripePurchase(input: StripePurchaseRecord): Promise<boolean> {
        const inserted = await this.database
            .insert(schema.templatePurchases)
            .values({
                id: generateId(),
                templateId: input.listingId,
                sourceAppId: input.sourceAppId,
                versionId: input.versionId,
                userId: input.userId,
                priceCents: input.priceCents,
                provider: 'stripe',
                stripeCheckoutSessionId: input.checkoutSessionId,
                stripePaymentIntentId: input.paymentIntentId,
                platformFeeCents: input.platformFeeCents,
                sellerAmountCents: input.sellerAmountCents,
                currency: input.currency,
                sellerStripeAccountId: input.sellerStripeAccountId,
                createdAt: new Date(),
            })
            .onConflictDoNothing()
            .returning({ id: schema.templatePurchases.id });
        return inserted.length > 0;
    }

    /** The latest Stripe sales, newest first, including those of deleted sites, so the list matches `sumPlatformFees`. */
    async listRecentSales(limit: number): Promise<SaleRow[]> {
        return this.database
            .select({
                purchaseId: schema.templatePurchases.id,
                appId: schema.templatePurchases.sourceAppId,
                appTitle: schema.apps.title,
                buyerEmail: schema.users.email,
                priceCents: schema.templatePurchases.priceCents,
                platformFeeCents: schema.templatePurchases.platformFeeCents,
                createdAt: schema.templatePurchases.createdAt,
            })
            .from(schema.templatePurchases)
            .leftJoin(schema.apps, eq(schema.apps.id, schema.templatePurchases.sourceAppId))
            .leftJoin(schema.users, eq(schema.users.id, schema.templatePurchases.userId))
            .where(eq(schema.templatePurchases.provider, 'stripe'))
            .orderBy(desc(schema.templatePurchases.createdAt))
            .limit(limit)
            .all();
    }

    async sumPlatformFees(): Promise<number> {
        const row = await this.database
            .select({ total: sql<number>`coalesce(sum(${schema.templatePurchases.platformFeeCents}), 0)` })
            .from(schema.templatePurchases)
            .where(eq(schema.templatePurchases.provider, 'stripe'))
            .get();
        return row?.total ?? 0;
    }
}
