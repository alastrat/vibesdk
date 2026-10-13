/**
 * Response projections for publishing and review endpoints: the single
 * source of truth for which listing fields leave the worker.
 */

import { parseStoredPageCopy } from '../../../../shared/types/site-page';
import type { TemplateShotKind } from '../../../../shared/types/templates';
import type { Template, TemplateVersion } from '../../../database/schema';
import type { PendingVersionRow } from '../../../database/services/TemplateService';
import type { OwnerPaidListing, PaidListingVersionView, PendingReview } from './types';

const UNKNOWN_CREATOR = 'Unknown';

function isoDate(value: Date | null): string | null {
    return value ? value.toISOString() : null;
}

export function reviewScreenshotUrl(versionId: string, kind: TemplateShotKind): string {
    return `/api/admin/template-versions/${versionId}/screenshots/${kind}`;
}

export function toPaidListingVersion(version: TemplateVersion): PaidListingVersionView {
    return {
        id: version.id,
        version: version.version,
        priceCents: version.priceCents,
        status: version.status,
        rejectionReason: version.rejectionReason,
        submittedAt: isoDate(version.createdAt),
        reviewedAt: isoDate(version.reviewedAt),
    };
}

export function toOwnerPaidListing(listing: Template, versions: TemplateVersion[], buyerCount: number): OwnerPaidListing {
    return {
        id: listing.id,
        status: listing.status,
        approvedPriceCents: listing.currentVersionId ? listing.priceCents : null,
        currentVersionId: listing.currentVersionId,
        buyerCount,
        versions: [...versions].sort((a, b) => b.version - a.version).map(toPaidListingVersion),
    };
}

export function toPendingReview(row: PendingVersionRow): PendingReview {
    return {
        versionId: row.version.id,
        version: row.version.version,
        listingId: row.listing.id,
        appId: row.listing.sourceAppId,
        appTitle: row.appTitle,
        priceCents: row.version.priceCents,
        fileCount: row.version.fileCount,
        totalBytes: row.version.totalBytes,
        creatorName: row.creatorName ?? UNKNOWN_CREATOR,
        creatorEmail: row.creatorEmail,
        submittedAt: isoDate(row.version.createdAt),
        desktopShotUrl: reviewScreenshotUrl(row.version.id, 'desktop'),
        mobileShotUrl: reviewScreenshotUrl(row.version.id, 'mobile'),
        pageCopy: parseStoredPageCopy(row.version.pageCopy),
    };
}
