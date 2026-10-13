import { formatTemplatePrice, type OwnerPaidListing, type PaidListingVersionView } from '@/api-types';

export interface PaidListingStatusView {
	label: string;
	variant: 'warning' | 'success' | 'error' | 'secondary';
	detail: string | null;
	pendingVersionId: string | null;
}

function rejectedDetail(latest: PaidListingVersionView | undefined): string | null {
	if (latest?.status !== 'rejected') return null;
	return latest.rejectionReason
		? `Version ${latest.version} was rejected: ${latest.rejectionReason}`
		: `Version ${latest.version} was rejected`;
}

/** How the owner's paid listing stands; null when the site is free again. */
export function paidListingStatusView(listing: OwnerPaidListing): PaidListingStatusView | null {
	if (listing.status === 'unlisted') return null;
	const pending = listing.versions.find((version) => version.status === 'pending');
	const latest = listing.versions[0];
	if (listing.approvedPriceCents !== null) {
		return {
			label: `Approved at ${formatTemplatePrice(listing.approvedPriceCents)}`,
			variant: 'success',
			detail: pending ? `Version ${pending.version} is in review` : rejectedDetail(latest),
			pendingVersionId: pending?.id ?? null,
		};
	}
	if (pending) {
		return {
			label: 'Price in review',
			variant: 'warning',
			detail: `${formatTemplatePrice(pending.priceCents)} is waiting for an admin`,
			pendingVersionId: pending.id,
		};
	}
	if (latest?.status === 'rejected') {
		return { label: 'Rejected', variant: 'error', detail: latest.rejectionReason, pendingVersionId: null };
	}
	return { label: 'Not submitted', variant: 'secondary', detail: null, pendingVersionId: null };
}

/**
 * The price the publish dialog starts from: the one in review, else the approved one, else the newest asked.
 * Reopening the dialog never resets a paid site to free or back to a rejected price.
 */
export function savedListingPrice(listing: OwnerPaidListing | null): number {
	if (!listing || listing.status !== 'listed') return 0;
	const pending = listing.versions.find((version) => version.status === 'pending');
	return pending?.priceCents ?? listing.approvedPriceCents ?? listing.versions[0]?.priceCents ?? 0;
}

export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
