/**
 * API types for templates: the public gallery, creators, purchases and
 * admin review.
 */

import type {
    TemplateCategory,
    TemplateListingStatus,
    TemplateVersionStatus,
} from '../../../../shared/types/templates';

export interface PublicTemplateCard {
    id: string;
    slug: string;
    name: string;
    description: string;
    category: TemplateCategory;
    priceCents: number;
    creatorName: string;
    useCount: number;
    publishedAt: string | null;
    desktopShotUrl: string;
    mobileShotUrl: string;
}

export interface PublicTemplateDetail extends PublicTemplateCard {
    version: number;
    fileCount: number;
}

/** What the current viewer may do with a template. */
export interface TemplateViewerAccess {
    isCreator: boolean;
    purchased: boolean;
    canUse: boolean;
}

export interface TemplateGalleryParams {
    page?: number;
    limit?: number;
    category?: TemplateCategory;
    search?: string;
}

export interface TemplateGalleryData {
    templates: PublicTemplateCard[];
    total: number;
    page: number;
    hasMore: boolean;
}

export interface TemplateDetailData {
    template: PublicTemplateDetail;
    viewer: TemplateViewerAccess;
}

export interface TemplatePurchaseData {
    templateId: string;
    purchased: true;
    testMode: true;
}

/** The template an app started from, shown on the app page. */
export interface TemplateOrigin {
    slug: string;
    name: string;
    creatorName: string;
    listed: boolean;
}

export interface CreatorTemplateVersion {
    id: string;
    version: number;
    status: TemplateVersionStatus;
    rejectionReason: string | null;
    submittedAt: string | null;
    reviewedAt: string | null;
}

export interface CreatorTemplate {
    id: string;
    slug: string;
    name: string;
    description: string;
    category: TemplateCategory;
    priceCents: number;
    status: TemplateListingStatus;
    useCount: number;
    currentVersionId: string | null;
    /** Newest first. */
    versions: CreatorTemplateVersion[];
}

export interface AppTemplateData {
    eligible: boolean;
    reason: string | null;
    template: CreatorTemplate | null;
}

export interface MyTemplatesData {
    templates: CreatorTemplate[];
}

export interface SubmitTemplateRequest {
    name?: string;
    description?: string;
    category?: TemplateCategory;
    priceCents?: number;
    rightsConfirmed: boolean;
}

export interface SubmitTemplateData {
    templateId: string;
    versionId: string;
    version: number;
}

export interface TemplateVersionActionData {
    versionId: string;
    status: TemplateVersionStatus;
}

export interface TemplateListingRequest {
    listed: boolean;
}

export interface TemplateListingData {
    templateId: string;
    status: TemplateListingStatus;
}

export interface PendingTemplateVersion {
    versionId: string;
    version: number;
    templateId: string;
    templateName: string;
    templateSlug: string;
    description: string;
    category: TemplateCategory;
    priceCents: number;
    fileCount: number;
    totalBytes: number;
    creatorName: string;
    creatorEmail: string | null;
    sourceAppId: string | null;
    submittedAt: string | null;
    desktopShotUrl: string;
    mobileShotUrl: string;
}

export interface PendingTemplateVersionsData {
    versions: PendingTemplateVersion[];
}

export interface TemplateVersionFilesData {
    files: Array<{ path: string; bytes: number }>;
}

export interface TemplateVersionFileData {
    path: string;
    bytes: number;
    binary: boolean;
    content: string | null;
}

export interface RejectTemplateRequest {
    reason: string;
}
