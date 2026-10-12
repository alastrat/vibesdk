/** Row fixtures for template tests. */

import type { Template, TemplateVersion } from '../../database/schema';
import type { TemplateWithVersion } from '../../database/services/TemplateService';

export function makeTemplate(overrides: Partial<Template> = {}): Template {
	return {
		id: 'tpl1',
		slug: 'fernwood-socks',
		creatorUserId: 'creator-private-id',
		sourceAppId: 'app-private-id',
		name: 'Fernwood Socks',
		description: 'A cozy merino sock store.',
		category: 'store',
		currentVersionId: 'ver2',
		status: 'listed',
		priceCents: 2900,
		useCount: 7,
		createdAt: new Date('2026-10-01T00:00:00Z'),
		updatedAt: new Date('2026-10-02T00:00:00Z'),
		...overrides,
	};
}

export function makeVersion(overrides: Partial<TemplateVersion> = {}): TemplateVersion {
	return {
		id: 'ver2',
		templateId: 'tpl1',
		version: 2,
		sourceCommit: 'deadbeefcafe',
		snapshotKey: 'templates/tpl1/ver2/files.json',
		fileCount: 12,
		totalBytes: 34567,
		desktopShotKey: 'templates/tpl1/ver2/desktop.jpg',
		mobileShotKey: 'templates/tpl1/ver2/mobile.jpg',
		status: 'approved',
		rightsConfirmedAt: new Date('2026-10-02T00:00:00Z'),
		reviewedBy: 'admin-private-id',
		reviewedAt: new Date('2026-10-03T00:00:00Z'),
		rejectionReason: null,
		createdAt: new Date('2026-10-02T00:00:00Z'),
		...overrides,
	};
}

export function makeTemplateRow(
	template: Partial<Template> = {},
	version: Partial<TemplateVersion> = {},
	creatorName: string | null = 'Andres',
): TemplateWithVersion {
	return { template: makeTemplate(template), version: makeVersion(version), creatorName };
}
