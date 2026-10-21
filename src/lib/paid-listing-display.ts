import { t, getLocale, msg } from '@/lib/i18n';
import { formatUsd, formatTemplatePrice, type OwnerPaidListing, type PaidListingVersionView } from '@/api-types';

export const PAYMENTS_NOT_CONFIGURED_MESSAGE = msg("Payments aren't set up on this deployment.");

export interface PaidListingStatusView {
	label: string;
	variant: 'warning' | 'success' | 'error' | 'secondary';
	detail: string | null;
	pendingVersionId: string | null;
}

function rejectedDetail(latest: PaidListingVersionView | undefined): string | null {
	if (latest?.status !== 'rejected') return null;
	return latest.rejectionReason
		? t("Version {value1} was rejected: {value2}", { value1: latest.version, value2: latest.rejectionReason })
		: t("Version {value1} was rejected", { value1: latest.version });
}

/** How the owner's paid listing stands; null when the site is free again. */
export function paidListingStatusView(listing: OwnerPaidListing): PaidListingStatusView | null {
	if (listing.status === 'unlisted') return null;
	const pending = listing.versions.find((version) => version.status === 'pending');
	const latest = listing.versions[0];
	if (listing.approvedPriceCents !== null) {
		return {
			label: t("Approved at {value1}", { value1: formatTemplatePrice(listing.approvedPriceCents, getLocale(), t('Free')) }),
			variant: 'success',
			detail: pending ? t("Version {value1} is in review", { value1: pending.version }) : rejectedDetail(latest),
			pendingVersionId: pending?.id ?? null,
		};
	}
	if (pending) {
		return {
			label: t("Price in review"),
			variant: 'warning',
			detail: t('{price} is waiting for an admin', { price: formatTemplatePrice(pending.priceCents, getLocale(), t('Free')) }),
			pendingVersionId: pending.id,
		};
	}
	if (latest?.status === 'rejected') {
		return { label: t("Rejected"), variant: 'error', detail: latest.rejectionReason, pendingVersionId: null };
	}
	return { label: t("Not submitted"), variant: 'secondary', detail: null, pendingVersionId: null };
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

/** A money amount in dollars; zero reads "$0" because formatTemplatePrice(0) is "Free". */
export function formatMoney(cents: number): string {
	return formatUsd(cents, getLocale());
}
