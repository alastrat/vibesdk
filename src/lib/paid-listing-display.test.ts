import { describe, expect, it } from 'vitest';
import type { OwnerPaidListing, PaidListingVersionView } from '@/api-types';
import { formatFileSize, paidListingStatusView, savedListingPrice } from './paid-listing-display';

function version(overrides: Partial<PaidListingVersionView>): PaidListingVersionView {
	return {
		id: 'v1',
		version: 1,
		priceCents: 2900,
		status: 'pending',
		rejectionReason: null,
		submittedAt: null,
		reviewedAt: null,
		...overrides,
	};
}

function listing(overrides: Partial<OwnerPaidListing>): OwnerPaidListing {
	return {
		id: 'l1',
		status: 'listed',
		approvedPriceCents: null,
		currentVersionId: null,
		buyerCount: 0,
		versions: [],
		...overrides,
	};
}

describe('paidListingStatusView', () => {
	it('shows nothing for a site that went back to free', () => {
		expect(paidListingStatusView(listing({ status: 'unlisted' }))).toBeNull();
	});

	it('shows the price in review before the first approval', () => {
		expect(paidListingStatusView(listing({ versions: [version({})] }))).toEqual({
			label: 'Price in review',
			variant: 'warning',
			detail: '$29 is waiting for an admin',
			pendingVersionId: 'v1',
		});
	});

	it('shows the rejection reason', () => {
		expect(
			paidListingStatusView(listing({ versions: [version({ status: 'rejected', rejectionReason: 'Copied brand' })] })),
		).toEqual({ label: 'Rejected', variant: 'error', detail: 'Copied brand', pendingVersionId: null });
	});

	it('shows the approved price and an update in review', () => {
		const approved = listing({
			approvedPriceCents: 2900,
			currentVersionId: 'v1',
			versions: [version({ id: 'v2', version: 2 }), version({ status: 'approved' })],
		});
		expect(paidListingStatusView(approved)).toEqual({
			label: 'Approved at $29',
			variant: 'success',
			detail: 'Version 2 is in review',
			pendingVersionId: 'v2',
		});
	});
});

describe('savedListingPrice', () => {
	it('is free without a listed paid listing', () => {
		expect(savedListingPrice(null)).toBe(0);
		expect(savedListingPrice(listing({ status: 'unlisted', approvedPriceCents: 1900 }))).toBe(0);
	});

	it('shows the price in review', () => {
		const inReview = listing({
			approvedPriceCents: 1900,
			currentVersionId: 'v1',
			versions: [version({ id: 'v2', version: 2, priceCents: 4900 }), version({ status: 'approved', priceCents: 1900 })],
		});
		expect(savedListingPrice(inReview)).toBe(4900);
	});

	it('keeps the approved price after a higher price is rejected', () => {
		const rejected = listing({
			approvedPriceCents: 1900,
			currentVersionId: 'v1',
			versions: [
				version({ id: 'v2', version: 2, priceCents: 4900, status: 'rejected' }),
				version({ status: 'approved', priceCents: 1900 }),
			],
		});
		expect(savedListingPrice(rejected)).toBe(1900);
	});

	it('shows the newest price before the first approval, or free with no versions', () => {
		expect(savedListingPrice(listing({ versions: [version({ status: 'rejected', priceCents: 4900 })] }))).toBe(4900);
		expect(savedListingPrice(listing({}))).toBe(0);
	});
});

describe('formatFileSize', () => {
	it('formats bytes, kilobytes and megabytes', () => {
		expect(formatFileSize(512)).toBe('512 B');
		expect(formatFileSize(2048)).toBe('2.0 KB');
		expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB');
	});
});
