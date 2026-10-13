/** API types for publishing sites, paid listings, purchases and admin review. */

import type {
    TemplateCategory,
    TemplateListingStatus,
    TemplateVersionStatus,
} from '../../../../shared/types/templates';

export interface PublishSiteRequest {
    visibility: 'private' | 'public';
    reuseConsent?: boolean;
    category?: TemplateCategory | null;
    priceCents?: number;
}

export interface PublishSiteData {
    visibility: 'private' | 'public';
    /** A paid version is waiting for an admin. */
    inReview: boolean;
    message: string;
}

export interface PaidListingVersionView {
    id: string;
    version: number;
    priceCents: number;
    status: TemplateVersionStatus;
    rejectionReason: string | null;
    submittedAt: string | null;
    reviewedAt: string | null;
}

export interface OwnerPaidListing {
    id: string;
    status: TemplateListingStatus;
    /** The approved price, or null before the first approval. */
    approvedPriceCents: number | null;
    currentVersionId: string | null;
    buyerCount: number;
    /** Newest first. */
    versions: PaidListingVersionView[];
}

export interface SitePublishingData {
    visibility: 'private' | 'public';
    category: TemplateCategory | null;
    /** Why the app can't be published now, or null when it can. */
    ineligibleReason: string | null;
    listing: OwnerPaidListing | null;
    removedFromDiscover: { reason: string | null } | null;
}

export interface PaidVersionActionData {
    versionId: string;
    status: TemplateVersionStatus;
}

export interface SitePurchaseData {
    appId: string;
    purchased: true;
    testMode: true;
}

export interface MyPaidListing extends OwnerPaidListing {
    appId: string;
    appTitle: string;
}

export interface MyPaidListingsData {
    listings: MyPaidListing[];
}

export interface PendingReview {
    versionId: string;
    version: number;
    listingId: string;
    appId: string;
    appTitle: string;
    priceCents: number;
    fileCount: number;
    totalBytes: number;
    creatorName: string;
    creatorEmail: string | null;
    submittedAt: string | null;
    desktopShotUrl: string;
    mobileShotUrl: string;
}

export interface PendingReviewsData {
    reviews: PendingReview[];
}

export interface ReviewVersionFilesData {
    files: Array<{ path: string; bytes: number }>;
}

export interface ReviewVersionFileData {
    path: string;
    bytes: number;
    binary: boolean;
    content: string | null;
}

export interface RejectVersionRequest {
    reason: string;
}

export interface DiscoverRemovalRequest {
    removed: boolean;
    reason?: string;
}

export interface DiscoverRemovalData {
    appId: string;
    removed: boolean;
}
