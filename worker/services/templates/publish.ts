/**
 * Publishing an app: make it private, or public with consent, a category and
 * a price. A paid publish stores a version for admin review before anything
 * else changes, so a failed submission never makes a site reusable for free.
 * Dependencies are injected so the ordering rules are tested.
 */

import type { TemplateSource } from '../../agents/core/types';
import { samePageCopy, type SitePageCopy } from '../../../shared/types/site-page';
import { buildSnapshot, type TreeFile } from './snapshot';
import { READ_FAILED_MESSAGE, TemplateSubmissionError } from './submit';
import { PAYMENTS_NOT_CONFIGURED_MESSAGE, SELLER_NOT_ONBOARDED_MESSAGE } from '../payments/config';
import { NOT_DEPLOYED_REASON, planPublish, publishEligibilityReason, type ListingState, type PublishRequest } from './reuse';

export interface PublishDeps {
	/** The app's paid listing with the text last sent for review (pending, else approved), or null when it never had a price. */
	loadListing(): Promise<{ id: string; state: ListingState; reviewedCopy: SitePageCopy | null } | null>;
	loadSource(): Promise<{ behaviorType: string; source: TemplateSource | null }>;
	readTree(commit: string): Promise<TreeFile[]>;
	/** Create an unlisted listing and return its id. */
	createListing(): Promise<string>;
	/** Unlisting also withdraws a version in review. */
	setListingStatus(listingId: string, status: 'listed' | 'unlisted'): Promise<void>;
	/** Store the deployed commit as a pending version at this price with this page text; throws TemplateSubmissionError. */
	submitVersion(listingId: string, source: TemplateSource, priceCents: number, pageCopy: SitePageCopy | null): Promise<void>;
	/** The creator's saved page text. */
	loadSavedCopy(): Promise<SitePageCopy | null>;
	/** Save the creator's page text; null clears it. */
	savePageCopy(copy: SitePageCopy | null): Promise<void>;
	applyVisibility(request: PublishRequest): Promise<void>;
	/** Whether the owner can be paid: Stripe configured and their account able to receive transfers. */
	sellerPayouts(): Promise<'ready' | 'not-configured' | 'not-onboarded'>;
}

export type PublishOutcome =
	| { ok: true; inReview: boolean }
	| { ok: false; status: 400 | 409 | 500; error: string };

export async function publishSite(deps: PublishDeps, request: PublishRequest): Promise<PublishOutcome> {
	if (request.visibility === 'private') {
		await deps.applyVisibility(request);
		return { ok: true, inReview: false };
	}

	const { behaviorType, source } = await deps.loadSource();
	const ineligible = publishEligibilityReason(behaviorType, source !== null);
	if (ineligible || !source) return { ok: false, status: 400, error: ineligible ?? NOT_DEPLOYED_REASON };

	const listing = await deps.loadListing();
	const textChanged =
		request.pageCopy !== undefined && !samePageCopy(request.pageCopy, listing?.reviewedCopy ?? null);
	const plan = planPublish(listing?.state ?? null, request.priceCents, textChanged);
	if (plan.kind === 'conflict') return { ok: false, status: 409, error: plan.error };

	if (plan.kind === 'free') {
		let files: TreeFile[];
		try {
			files = await deps.readTree(source.commit);
		} catch {
			return { ok: false, status: 500, error: READ_FAILED_MESSAGE };
		}
		const snapshot = buildSnapshot(files);
		if (!snapshot.ok) return { ok: false, status: 400, error: snapshot.error };
		if (plan.unlistListing && listing) await deps.setListingStatus(listing.id, 'unlisted');
		if (request.pageCopy !== undefined) await deps.savePageCopy(request.pageCopy);
		await deps.applyVisibility(request);
		return { ok: true, inReview: false };
	}

	const payouts = await deps.sellerPayouts();
	if (payouts === 'not-configured') return { ok: false, status: 400, error: PAYMENTS_NOT_CONFIGURED_MESSAGE };
	if (payouts === 'not-onboarded') return { ok: false, status: 400, error: SELLER_NOT_ONBOARDED_MESSAGE };

	try {
		const listingId = listing?.id ?? (await deps.createListing());
		if (plan.submitVersion) {
			const versionCopy = request.pageCopy !== undefined ? request.pageCopy : await deps.loadSavedCopy();
			await deps.submitVersion(listingId, source, request.priceCents, versionCopy);
		}
		if (plan.listListing) await deps.setListingStatus(listingId, 'listed');
	} catch (error) {
		if (error instanceof TemplateSubmissionError) return { ok: false, status: error.status, error: error.message };
		throw error;
	}
	if (request.pageCopy !== undefined) await deps.savePageCopy(request.pageCopy);
	await deps.applyVisibility(request);
	return { ok: true, inReview: plan.submitVersion || (listing?.state.pendingPriceCents ?? null) !== null };
}
