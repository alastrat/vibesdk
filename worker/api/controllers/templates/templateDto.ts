/**
 * Response projections for template endpoints. The single source of truth
 * for which template fields leave the worker; any new public field is added
 * here explicitly.
 */

import type { TemplateShotKind } from '../../../../shared/types/templates';
import type { Template, TemplateVersion } from '../../../database/schema';
import type {
    PendingVersionRow,
    TemplateOriginRow,
    TemplateWithVersion,
} from '../../../database/services/TemplateService';
import type {
    CreatorTemplate,
    PendingTemplateVersion,
    PublicTemplateCard,
    PublicTemplateDetail,
    TemplateOrigin,
} from './types';

const UNKNOWN_CREATOR = 'Unknown';

function isoDate(value: Date | null): string | null {
    return value ? value.toISOString() : null;
}

/** Public screenshot of a template's current version; the version id busts caches on a new version. */
export function templateScreenshotUrl(templateId: string, versionId: string, kind: TemplateShotKind): string {
    return `/api/templates/${templateId}/screenshots/${kind}?v=${versionId}`;
}

export function reviewScreenshotUrl(versionId: string, kind: TemplateShotKind): string {
    return `/api/admin/template-versions/${versionId}/screenshots/${kind}`;
}

export function toPublicTemplateCard(row: TemplateWithVersion): PublicTemplateCard {
    return {
        id: row.template.id,
        slug: row.template.slug,
        name: row.template.name,
        description: row.template.description,
        category: row.template.category,
        priceCents: row.template.priceCents,
        creatorName: row.creatorName ?? UNKNOWN_CREATOR,
        useCount: row.template.useCount,
        publishedAt: isoDate(row.version.reviewedAt),
        desktopShotUrl: templateScreenshotUrl(row.template.id, row.version.id, 'desktop'),
        mobileShotUrl: templateScreenshotUrl(row.template.id, row.version.id, 'mobile'),
    };
}

export function toPublicTemplateDetail(row: TemplateWithVersion): PublicTemplateDetail {
    return {
        ...toPublicTemplateCard(row),
        version: row.version.version,
        fileCount: row.version.fileCount,
    };
}

export function toCreatorTemplate(template: Template, versions: TemplateVersion[]): CreatorTemplate {
    return {
        id: template.id,
        slug: template.slug,
        name: template.name,
        description: template.description,
        category: template.category,
        priceCents: template.priceCents,
        status: template.status,
        useCount: template.useCount,
        currentVersionId: template.currentVersionId,
        versions: [...versions]
            .sort((a, b) => b.version - a.version)
            .map((version) => ({
                id: version.id,
                version: version.version,
                status: version.status,
                rejectionReason: version.rejectionReason,
                submittedAt: isoDate(version.createdAt),
                reviewedAt: isoDate(version.reviewedAt),
            })),
    };
}

export function toPendingTemplateVersion(row: PendingVersionRow): PendingTemplateVersion {
    return {
        versionId: row.version.id,
        version: row.version.version,
        templateId: row.template.id,
        templateName: row.template.name,
        templateSlug: row.template.slug,
        description: row.template.description,
        category: row.template.category,
        priceCents: row.template.priceCents,
        fileCount: row.version.fileCount,
        totalBytes: row.version.totalBytes,
        creatorName: row.creatorName ?? UNKNOWN_CREATOR,
        creatorEmail: row.creatorEmail,
        sourceAppId: row.template.sourceAppId,
        submittedAt: isoDate(row.version.createdAt),
        desktopShotUrl: reviewScreenshotUrl(row.version.id, 'desktop'),
        mobileShotUrl: reviewScreenshotUrl(row.version.id, 'mobile'),
    };
}

export function toTemplateOrigin(row: TemplateOriginRow): TemplateOrigin {
    return {
        slug: row.slug,
        name: row.name,
        creatorName: row.creatorName ?? UNKNOWN_CREATOR,
        listed: row.status === 'listed',
    };
}
