/**
 * The product page projection: which offer a viewer gets, which text the page
 * shows, and which screenshots are public. Pure, so each rule is unit-tested.
 */

import { parseStoredPageCopy, type SitePageCopy } from '../../../../shared/types/site-page';
import type { TemplateListingStatus, TemplateShotKind, TemplateVersionStatus } from '../../../../shared/types/templates';
import type { EnhancedAppData } from '../../../database/types';
import type { SitePageCard, SitePageData, SitePageOffer } from './types';

interface ListingView {
    status: TemplateListingStatus;
    currentVersionId: string | null;
    priceCents: number;
}

interface VersionView {
    id: string;
    status: TemplateVersionStatus;
    pageCopy: string | null;
    reviewedAt: Date | null;
    desktopShotKey: string;
    mobileShotKey: string;
}

export interface SitePageSource {
    app: Pick<
        EnhancedAppData,
        | 'id'
        | 'title'
        | 'description'
        | 'category'
        | 'screenshotUrl'
        | 'createdAt'
        | 'reuseConsentAt'
        | 'lastDeployedAt'
        | 'userName'
        | 'userAvatar'
        | 'viewCount'
        | 'starCount'
        | 'forkCount'
    >;
    isOwner: boolean;
    hasPurchase: boolean;
    /** The site has a deployed Think commit, so a free copy can start from it. */
    reusable: boolean;
    listing: ListingView | null;
    approvedVersion: VersionView | null;
    savedCopy: SitePageCopy | null;
    previewUrl: string | null;
    moreFromCreator: SitePageCard[];
}

function isoDate(value: Date | null | undefined): string | null {
    return value ? value.toISOString() : null;
}

function listedListing(listing: ListingView | null): ListingView | null {
    return listing?.status === 'listed' ? listing : null;
}

export function siteOffer(input: {
    isOwner: boolean;
    hasPurchase: boolean;
    reusable: boolean;
    listing: ListingView | null;
}): SitePageOffer {
    const listed = listedListing(input.listing);
    if (input.isOwner) {
        return { kind: 'own', canUse: listed ? listed.currentVersionId !== null : input.reusable };
    }
    if (listed) {
        if (listed.currentVersionId === null) return { kind: 'not-yet-available' };
        return input.hasPurchase ? { kind: 'owned' } : { kind: 'paid', priceCents: listed.priceCents };
    }
    return input.reusable ? { kind: 'free' } : { kind: 'not-yet-available' };
}

/** A paid site shows its approved version's text; a free site shows the saved text. */
export function pageCopyFor(
    listing: ListingView | null,
    approvedVersion: VersionView | null,
    savedCopy: SitePageCopy | null,
): SitePageCopy | null {
    const listed = listedListing(listing);
    if (!listed) return savedCopy;
    if (!listed.currentVersionId || approvedVersion?.id !== listed.currentVersionId) return null;
    return parseStoredPageCopy(approvedVersion.pageCopy);
}

/** The R2 key of a public screenshot: only the current approved version of a listed paid site. */
export function approvedShotKey(
    listing: ListingView | null,
    version: VersionView | null,
    kind: TemplateShotKind,
): string | null {
    const listed = listedListing(listing);
    if (!listed || !version || version.id !== listed.currentVersionId || version.status !== 'approved') return null;
    return kind === 'desktop' ? version.desktopShotKey : version.mobileShotKey;
}

export function sitePageScreenshotUrl(appId: string, versionId: string, kind: TemplateShotKind): string {
    return `/api/discover/${appId}/screenshots/${kind}?v=${versionId}`;
}

export function toSitePageData(source: SitePageSource): SitePageData {
    const { app, listing, approvedVersion } = source;
    const listed = listedListing(listing);
    const approved =
        listed && listed.currentVersionId && approvedVersion?.id === listed.currentVersionId ? approvedVersion : null;
    return {
        id: app.id,
        title: app.title,
        category: app.category,
        description: app.description,
        copy: pageCopyFor(listing, approvedVersion, source.savedCopy),
        offer: siteOffer(source),
        paid: listed !== null,
        priceCents: approved && listed ? listed.priceCents : null,
        creator: { displayName: app.userName ?? 'Unknown', avatarUrl: app.userAvatar },
        stats: { uses: app.forkCount ?? 0, views: app.viewCount ?? 0, likes: app.starCount },
        publishedAt: isoDate(app.reuseConsentAt ?? app.createdAt),
        updatedAt: isoDate(approved ? approved.reviewedAt : app.lastDeployedAt),
        previewUrl: source.previewUrl,
        screenshotUrl: app.screenshotUrl,
        approvedShots: approved
            ? {
                  desktop: sitePageScreenshotUrl(app.id, approved.id, 'desktop'),
                  mobile: sitePageScreenshotUrl(app.id, approved.id, 'mobile'),
              }
            : null,
        moreFromCreator: source.moreFromCreator,
    };
}
