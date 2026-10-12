/**
 * D1 reads and writes for templates, their versions and purchases. Decisions
 * (who may do what, which version is superseded) live in
 * services/templates/catalog.ts; this service only moves rows.
 */

import { and, desc, eq, inArray, isNotNull, like, or, sql, type SQL } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { generateId } from '../../utils/idGenerator';
import type { TemplateCategory, TemplateListingStatus } from '../../../shared/types/templates';

export interface TemplateWithVersion {
    template: schema.Template;
    version: schema.TemplateVersion;
    creatorName: string | null;
}

export interface PendingVersionRow extends TemplateWithVersion {
    creatorEmail: string | null;
}

export interface CreatorTemplateRow {
    template: schema.Template;
    versions: schema.TemplateVersion[];
}

export interface TemplateOriginRow {
    slug: string;
    name: string;
    creatorName: string | null;
    status: TemplateListingStatus;
}

export interface PublishedQuery {
    category?: TemplateCategory;
    search?: string;
    limit: number;
    offset: number;
}

export class TemplateService extends BaseService {
    async getTemplate(templateId: string): Promise<schema.Template | null> {
        const row = await this.database.select().from(schema.templates).where(eq(schema.templates.id, templateId)).get();
        return row ?? null;
    }

    async getTemplateBySourceApp(appId: string): Promise<schema.Template | null> {
        const row = await this.database.select().from(schema.templates).where(eq(schema.templates.sourceAppId, appId)).get();
        return row ?? null;
    }

    async isSlugTaken(slug: string): Promise<boolean> {
        const row = await this.database
            .select({ id: schema.templates.id })
            .from(schema.templates)
            .where(eq(schema.templates.slug, slug))
            .get();
        return row !== undefined;
    }

    async getVersion(versionId: string): Promise<schema.TemplateVersion | null> {
        const row = await this.database
            .select()
            .from(schema.templateVersions)
            .where(eq(schema.templateVersions.id, versionId))
            .get();
        return row ?? null;
    }

    /** Versions of a template, newest first. */
    async listVersions(templateId: string): Promise<schema.TemplateVersion[]> {
        return this.database
            .select()
            .from(schema.templateVersions)
            .where(eq(schema.templateVersions.templateId, templateId))
            .orderBy(desc(schema.templateVersions.version))
            .all();
    }

    async nextVersionNumber(templateId: string): Promise<number> {
        const row = await this.database
            .select({ latest: sql<number | null>`max(${schema.templateVersions.version})` })
            .from(schema.templateVersions)
            .where(eq(schema.templateVersions.templateId, templateId))
            .get();
        return (row?.latest ?? 0) + 1;
    }

    /** Insert a submitted version, and the template itself on its first submission. */
    async insertSubmission(input: {
        template: schema.NewTemplate | null;
        version: schema.NewTemplateVersion;
    }): Promise<void> {
        const insertVersion = this.database.insert(schema.templateVersions).values(input.version);
        if (input.template) {
            await this.database.batch([this.database.insert(schema.templates).values(input.template), insertVersion]);
            return;
        }
        await insertVersion;
    }

    async listByCreator(userId: string): Promise<CreatorTemplateRow[]> {
        const templates = await this.database
            .select()
            .from(schema.templates)
            .where(eq(schema.templates.creatorUserId, userId))
            .orderBy(desc(schema.templates.createdAt))
            .all();
        if (templates.length === 0) return [];
        const versions = await this.database
            .select()
            .from(schema.templateVersions)
            .where(inArray(schema.templateVersions.templateId, templates.map((template) => template.id)))
            .orderBy(desc(schema.templateVersions.version))
            .all();
        return templates.map((template) => ({
            template,
            versions: versions.filter((version) => version.templateId === template.id),
        }));
    }

    /** Versions waiting for review, oldest first. */
    async listPending(): Promise<PendingVersionRow[]> {
        return this.database
            .select({
                template: schema.templates,
                version: schema.templateVersions,
                creatorName: schema.users.displayName,
                creatorEmail: schema.users.email,
            })
            .from(schema.templateVersions)
            .innerJoin(schema.templates, eq(schema.templates.id, schema.templateVersions.templateId))
            .leftJoin(schema.users, eq(schema.users.id, schema.templates.creatorUserId))
            .where(eq(schema.templateVersions.status, 'pending'))
            .orderBy(schema.templateVersions.createdAt)
            .limit(100)
            .all();
    }

    async getVersionWithTemplate(versionId: string): Promise<TemplateWithVersion | null> {
        const row = await this.database
            .select({
                template: schema.templates,
                version: schema.templateVersions,
                creatorName: schema.users.displayName,
            })
            .from(schema.templateVersions)
            .innerJoin(schema.templates, eq(schema.templates.id, schema.templateVersions.templateId))
            .leftJoin(schema.users, eq(schema.users.id, schema.templates.creatorUserId))
            .where(eq(schema.templateVersions.id, versionId))
            .get();
        return row ?? null;
    }

    /**
     * Publish a version: approve it, supersede the previous one, and list the
     * template. Returns false when the version was no longer pending; a version
     * that is not approved never becomes the template's current version.
     */
    async approveVersion(input: {
        templateId: string;
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
            .set({ currentVersionId: input.versionId, status: 'listed', updatedAt: now })
            .where(and(eq(schema.templates.id, input.templateId), nowApproved));
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

    async setListing(templateId: string, listed: boolean): Promise<void> {
        await this.database
            .update(schema.templates)
            .set({ status: listed ? 'listed' : 'unlisted', updatedAt: new Date() })
            .where(eq(schema.templates.id, templateId));
    }

    /** Listed templates with their current version, most used first. */
    async listPublished(query: PublishedQuery): Promise<{ rows: TemplateWithVersion[]; total: number }> {
        const extra: SQL[] = [];
        if (query.category) extra.push(eq(schema.templates.category, query.category));
        if (query.search) {
            const pattern = `%${query.search}%`;
            const matches = or(like(schema.templates.name, pattern), like(schema.templates.description, pattern));
            if (matches) extra.push(matches);
        }
        const where = this.publishedConditions(extra);
        const readDb = this.getReadDb('fast');
        const rows = await readDb
            .select({
                template: schema.templates,
                version: schema.templateVersions,
                creatorName: schema.users.displayName,
            })
            .from(schema.templates)
            .innerJoin(schema.templateVersions, eq(schema.templateVersions.id, schema.templates.currentVersionId))
            .leftJoin(schema.users, eq(schema.users.id, schema.templates.creatorUserId))
            .where(where)
            .orderBy(desc(schema.templates.useCount), desc(schema.templates.updatedAt))
            .limit(query.limit)
            .offset(query.offset)
            .all();
        const totalRow = await readDb
            .select({ count: sql<number>`count(*)` })
            .from(schema.templates)
            .where(where)
            .get();
        return { rows, total: totalRow?.count ?? 0 };
    }

    async getPublishedBySlug(slug: string): Promise<TemplateWithVersion | null> {
        return this.findPublished(eq(schema.templates.slug, slug));
    }

    async getPublishedById(templateId: string): Promise<TemplateWithVersion | null> {
        return this.findPublished(eq(schema.templates.id, templateId));
    }

    async incrementUseCount(templateId: string): Promise<void> {
        await this.database
            .update(schema.templates)
            .set({ useCount: sql`${schema.templates.useCount} + 1` })
            .where(eq(schema.templates.id, templateId));
    }

    /** The template an app started from, for the app page. */
    async getTemplateOrigin(versionId: string): Promise<TemplateOriginRow | null> {
        const row = await this.database
            .select({
                slug: schema.templates.slug,
                name: schema.templates.name,
                creatorName: schema.users.displayName,
                status: schema.templates.status,
            })
            .from(schema.templateVersions)
            .innerJoin(schema.templates, eq(schema.templates.id, schema.templateVersions.templateId))
            .leftJoin(schema.users, eq(schema.users.id, schema.templates.creatorUserId))
            .where(eq(schema.templateVersions.id, versionId))
            .get();
        return row ?? null;
    }

    async hasPurchase(templateId: string, userId: string): Promise<boolean> {
        const row = await this.database
            .select({ id: schema.templatePurchases.id })
            .from(schema.templatePurchases)
            .where(and(eq(schema.templatePurchases.templateId, templateId), eq(schema.templatePurchases.userId, userId)))
            .get();
        return row !== undefined;
    }

    /** Record a test-mode purchase (no charge). Buying twice keeps the first record. */
    async recordPurchase(input: { templateId: string; userId: string; priceCents: number }): Promise<void> {
        await this.database
            .insert(schema.templatePurchases)
            .values({
                id: generateId(),
                templateId: input.templateId,
                userId: input.userId,
                priceCents: input.priceCents,
                provider: 'test',
                createdAt: new Date(),
            })
            .onConflictDoNothing();
    }

    private publishedConditions(extra: SQL[]): SQL | undefined {
        return and(eq(schema.templates.status, 'listed'), isNotNull(schema.templates.currentVersionId), ...extra);
    }

    private async findPublished(condition: SQL): Promise<TemplateWithVersion | null> {
        const row = await this.database
            .select({
                template: schema.templates,
                version: schema.templateVersions,
                creatorName: schema.users.displayName,
            })
            .from(schema.templates)
            .innerJoin(schema.templateVersions, eq(schema.templateVersions.id, schema.templates.currentVersionId))
            .leftJoin(schema.users, eq(schema.users.id, schema.templates.creatorUserId))
            .where(this.publishedConditions([condition]))
            .get();
        return row ?? null;
    }
}
