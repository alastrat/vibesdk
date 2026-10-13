/** D1 reads and writes for product page text, and the other Discover sites a page links to. */

import { and, desc, eq, ne } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { discoverConditions, paidPriceSubquery } from '../discover-conditions';
import { parseStoredPageCopy, type SitePageCopy } from '../../../shared/types/site-page';

export interface CreatorSiteRow {
    id: string;
    title: string;
    screenshotUrl: string | null;
    /** The approved price of a listed paid listing; null for a free site. */
    priceCents: number | null;
}

export class SitePageService extends BaseService {
    async getCopy(appId: string): Promise<SitePageCopy | null> {
        const row = await this.database
            .select({ copy: schema.sitePages.copy })
            .from(schema.sitePages)
            .where(eq(schema.sitePages.appId, appId))
            .get();
        return parseStoredPageCopy(row?.copy ?? null);
    }

    /** Saves the text, or deletes the row when it is cleared. */
    async saveCopy(appId: string, copy: SitePageCopy | null): Promise<void> {
        if (!copy) {
            await this.database.delete(schema.sitePages).where(eq(schema.sitePages.appId, appId));
            return;
        }
        const json = JSON.stringify(copy);
        const now = new Date();
        await this.database
            .insert(schema.sitePages)
            .values({ appId, copy: json, updatedAt: now })
            .onConflictDoUpdate({ target: schema.sitePages.appId, set: { copy: json, updatedAt: now } });
    }

    async listCreatorSites(creatorUserId: string, excludeAppId: string, limit: number): Promise<CreatorSiteRow[]> {
        return this.database
            .select({
                id: schema.apps.id,
                title: schema.apps.title,
                screenshotUrl: schema.apps.screenshotUrl,
                priceCents: paidPriceSubquery,
            })
            .from(schema.apps)
            .where(
                and(
                    eq(schema.apps.userId, creatorUserId),
                    eq(schema.apps.visibility, 'public'),
                    ne(schema.apps.id, excludeAppId),
                    ...discoverConditions(undefined),
                ),
            )
            .orderBy(desc(schema.apps.updatedAt))
            .limit(limit)
            .all();
    }
}
