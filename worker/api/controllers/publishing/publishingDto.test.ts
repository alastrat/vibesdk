import { describe, expect, it } from 'vitest';
import type { Template, TemplateVersion } from '../../../database/schema';
import { toOwnerPaidListing, toPendingReview } from './publishingDto';

const listing: Template = {
	id: 'l1',
	sourceAppId: 'app1',
	creatorUserId: 'owner',
	currentVersionId: null,
	status: 'listed',
	priceCents: 0,
	createdAt: null,
	updatedAt: null,
};

const version: TemplateVersion = {
	id: 'v1',
	templateId: 'l1',
	version: 1,
	sourceCommit: 'c1',
	snapshotKey: 'templates/l1/v1/files.json',
	fileCount: 5,
	totalBytes: 2048,
	desktopShotKey: 'templates/l1/v1/desktop.jpg',
	mobileShotKey: 'templates/l1/v1/mobile.jpg',
	priceCents: 2900,
	status: 'pending',
	rightsConfirmedAt: new Date(0),
	reviewedBy: null,
	reviewedAt: null,
	rejectionReason: null,
	createdAt: new Date(0),
};

describe('toOwnerPaidListing', () => {
	it('has no approved price before the first approval', () => {
		const view = toOwnerPaidListing(listing, [version], 0);
		expect(view.approvedPriceCents).toBeNull();
		expect(view.versions).toEqual([
			{
				id: 'v1',
				version: 1,
				priceCents: 2900,
				status: 'pending',
				rejectionReason: null,
				submittedAt: new Date(0).toISOString(),
				reviewedAt: null,
			},
		]);
	});

	it('reports the approved price once a version is current', () => {
		const view = toOwnerPaidListing({ ...listing, currentVersionId: 'v1', priceCents: 2900 }, [], 3);
		expect(view.approvedPriceCents).toBe(2900);
		expect(view.buyerCount).toBe(3);
	});
});

describe('toPendingReview', () => {
	it('shows the asked price and never exposes storage keys', () => {
		const review = toPendingReview({
			listing,
			version,
			appTitle: 'North Ridge',
			creatorName: null,
			creatorEmail: 'c@example.test',
		});
		expect(review).toMatchObject({
			versionId: 'v1',
			appId: 'app1',
			appTitle: 'North Ridge',
			priceCents: 2900,
			creatorName: 'Unknown',
			desktopShotUrl: '/api/admin/template-versions/v1/screenshots/desktop',
		});
		expect(JSON.stringify(review)).not.toContain('templates/l1');
	});
});
