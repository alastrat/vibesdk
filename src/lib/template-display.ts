import type { CreatorTemplate } from '@/api-types';

export interface TemplateStatusView {
	label: string;
	variant: 'warning' | 'success' | 'error' | 'secondary';
	detail: string | null;
	pendingVersionId: string | null;
	canUnlist: boolean;
}

/** How a creator's template stands, from its listing and newest versions. */
export function templateStatusView(template: CreatorTemplate): TemplateStatusView {
	const pending = template.versions.find((version) => version.status === 'pending');
	const pendingDetail = pending ? `Version ${pending.version} is in review` : null;
	if (template.status === 'listed') {
		return {
			label: 'Published',
			variant: 'success',
			detail: pendingDetail,
			pendingVersionId: pending?.id ?? null,
			canUnlist: true,
		};
	}
	if (pending) {
		return { label: 'In review', variant: 'warning', detail: pendingDetail, pendingVersionId: pending.id, canUnlist: false };
	}
	const latest = template.versions[0];
	if (latest?.status === 'rejected') {
		return { label: 'Rejected', variant: 'error', detail: latest.rejectionReason, pendingVersionId: null, canUnlist: false };
	}
	if (template.currentVersionId) {
		return { label: 'Unlisted', variant: 'secondary', detail: null, pendingVersionId: null, canUnlist: false };
	}
	return { label: 'Withdrawn', variant: 'secondary', detail: null, pendingVersionId: null, canUnlist: false };
}

export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
