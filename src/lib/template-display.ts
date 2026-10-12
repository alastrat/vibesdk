import type { CreatorTemplate, CreatorTemplateVersion } from '@/api-types';

export interface TemplateStatusView {
	label: string;
	variant: 'warning' | 'success' | 'error' | 'secondary';
	detail: string | null;
	pendingVersionId: string | null;
	canUnlist: boolean;
}

/** Why the newest version was turned down, for a template that already has an approved version. */
function rejectedUpdateDetail(latest: CreatorTemplateVersion | undefined): string | null {
	if (latest?.status !== 'rejected') return null;
	return latest.rejectionReason
		? `Version ${latest.version} was rejected: ${latest.rejectionReason}`
		: `Version ${latest.version} was rejected`;
}

/** How a creator's template stands, from its listing and newest versions. */
export function templateStatusView(template: CreatorTemplate): TemplateStatusView {
	const pending = template.versions.find((version) => version.status === 'pending');
	const pendingDetail = pending ? `Version ${pending.version} is in review` : null;
	const latest = template.versions[0];
	if (template.status === 'listed') {
		return {
			label: 'Published',
			variant: 'success',
			detail: pendingDetail ?? rejectedUpdateDetail(latest),
			pendingVersionId: pending?.id ?? null,
			canUnlist: true,
		};
	}
	if (pending) {
		return { label: 'In review', variant: 'warning', detail: pendingDetail, pendingVersionId: pending.id, canUnlist: false };
	}
	if (template.currentVersionId) {
		return { label: 'Unlisted', variant: 'secondary', detail: rejectedUpdateDetail(latest), pendingVersionId: null, canUnlist: false };
	}
	if (latest?.status === 'rejected') {
		return { label: 'Rejected', variant: 'error', detail: latest.rejectionReason, pendingVersionId: null, canUnlist: false };
	}
	return { label: 'Withdrawn', variant: 'secondary', detail: null, pendingVersionId: null, canUnlist: false };
}

export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
