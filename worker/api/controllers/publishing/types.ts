/** API types for publishing sites, paid listings, purchases and admin review. */

import type { SitePageCopy } from '../../../../shared/types/site-page';
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
    /** Undefined keeps the saved page text; null clears it. */
    pageCopy?: SitePageCopy | null;
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
    /** The owner consented to reuse when publishing; sites public before consent existed have not. */
    hasReuseConsent: boolean;
    /** Why the app can't be published now, or null when it can. */
    ineligibleReason: string | null;
    listing: OwnerPaidListing | null;
    removedFromDiscover: { reason: string | null } | null;
    /** The creator's saved page text. */
    pageCopy: SitePageCopy | null;
    /** A paid version carrying page text is waiting for review. */
    pageCopyInReview: boolean;
}

export interface PaidVersionActionData {
    versionId: string;
    status: TemplateVersionStatus;
}

export interface SiteCheckoutData {
    /** Stripe Checkout page to send the buyer to. */
    checkoutUrl: string;
}

export interface ConfirmPurchaseRequest {
    sessionId: string;
}

export interface ConfirmPurchaseData {
    purchased: true;
}

export interface SaleView {
    purchaseId: string;
    /** Null once the site has been deleted. */
    appId: string | null;
    /** Null once the site has been deleted. */
    appTitle: string | null;
    buyerEmail: string | null;
    priceCents: number;
    platformFeeCents: number;
    soldAt: string | null;
}

export interface AdminSalesData {
    sales: SaleView[];
    totalFeesCents: number;
}

export interface MyPaidListing extends OwnerPaidListing {
    appId: string;
    appTitle: string;
    /** Stripe sales to date, in cents: what buyers paid, Estori's fee, and what the seller receives. */
    grossCents: number;
    feeCents: number;
    earningsCents: number;
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
    /** The page text submitted with this version. */
    pageCopy: SitePageCopy | null;
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
