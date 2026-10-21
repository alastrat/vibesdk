import { msg } from '../../../shared/i18n/translate';
/**
 * Discover publishing and reuse rules:
 * - what a publish request asks for, and what publishing does to a paid listing;
 * - whether a site can be reused, and from which files;
 * - admin removal and Discover's filters.
 * Pure, so every rule is unit-tested.
 */

import { validatePageCopy, type SitePageCopy } from '../../../shared/types/site-page';
import {
	DISCOVER_PRICING_FILTERS,
	type DiscoverPricing,
	type TemplateCategory,
	type TemplateListingStatus,
} from '../../../shared/types/templates';
import {
	MAX_REJECTION_REASON_LENGTH,
	VERSION_IN_REVIEW_ERROR,
	isTemplateCategory,
	isTemplatePrice,
	type Validation,
} from './catalog';

export const SITE_UNAVAILABLE_MESSAGE = msg('This site is no longer available');
export const SITE_PURCHASE_REQUIRED_MESSAGE = msg('Buy this site before using it');
export const SITE_NOT_YET_AVAILABLE_MESSAGE = msg("This site isn't available to use yet");
export const SITE_NOT_REUSABLE_MESSAGE = msg("This site can't be reused right now");
export const REUSE_CONSENT_REQUIRED_MESSAGE = msg('Confirm that others may copy and adapt this site');
export const NOT_THINK_REASON = 'Only apps built with the current builder can be published';
export const NOT_DEPLOYED_REASON = 'Deploy your app before publishing it';
export const PAID_COPY_REASON = "This site started from a paid site, so it can't be made public";
export const PUBLISHING_CHECK_FAILED_MESSAGE = msg("Couldn't check this app right now; try again");

export type PublishRequest =
	| { visibility: 'private' }
	| {
			visibility: 'public';
			category: TemplateCategory | null;
			priceCents: number;
			/** The page text to save; undefined keeps the saved text, null clears it. */
			pageCopy?: SitePageCopy | null;
	  };

/** A paid listing as publishing sees it. */
export interface ListingState {
	status: TemplateListingStatus;
	currentVersionId: string | null;
	/** The approved version's price; 0 before the first approval. */
	priceCents: number;
	/** The price asked by the version in review, or null when none is in review. */
	pendingPriceCents: number | null;
}

export type PublishPlan =
	| { kind: 'free'; unlistListing: boolean }
	| { kind: 'paid'; submitVersion: boolean; listListing: boolean }
	| { kind: 'conflict'; error: string };

export interface ReuseInput {
	visibility: 'private' | 'public';
	removedFromDiscover: boolean;
	isThink: boolean;
	deployedCommit: string | null;
	listing: { status: TemplateListingStatus; currentVersionId: string | null } | null;
	isOwner: boolean;
	hasPurchase: boolean;
}

export interface SourceAccessInput {
	visibility: 'private' | 'public';
	isOwner: boolean;
	/** The app's paid listing is in effect or in review. */
	paidListingListed: boolean;
	hasPurchase: boolean;
}

export type ReuseDecision =
	| { ok: true; source: 'live'; commit: string }
	| { ok: true; source: 'snapshot'; versionId: string }
	| { ok: false; status: 400 | 402 | 404 | 409; error: string };

export type DiscoverRemoval = { removed: true; reason: string } | { removed: false };

export interface DiscoverFilters {
	category: TemplateCategory | null;
	pricing: DiscoverPricing;
	reusableOnly: boolean;
	/** Only stores an admin chose for the landing page. */
	showcasedOnly: boolean;
}

function field(body: unknown, key: string): unknown {
	return typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[key] : undefined;
}

export function parsePublishRequest(body: unknown): Validation<PublishRequest> {
	const visibility = field(body, 'visibility');
	if (visibility === 'private') return { ok: true, value: { visibility: 'private' } };
	if (visibility !== 'public') return { ok: false, error: 'Visibility must be either "private" or "public"' };
	if (field(body, 'reuseConsent') !== true) return { ok: false, error: REUSE_CONSENT_REQUIRED_MESSAGE };

	const category = field(body, 'category');
	if (category !== undefined && category !== null && !isTemplateCategory(category)) {
		return { ok: false, error: 'Choose a category' };
	}
	const rawPrice = field(body, 'priceCents');
	const priceCents = rawPrice === undefined ? 0 : rawPrice;
	if (!isTemplatePrice(priceCents)) return { ok: false, error: 'Choose a price' };

	const rawCopy = field(body, 'pageCopy');
	let pageCopy: SitePageCopy | null | undefined;
	if (rawCopy === null) {
		pageCopy = null;
	} else if (rawCopy !== undefined) {
		const checked = validatePageCopy(rawCopy);
		if (!checked.ok) return { ok: false, error: checked.error };
		pageCopy = checked.value;
	}

	return {
		ok: true,
		value: {
			visibility: 'public',
			category: isTemplateCategory(category) ? category : null,
			priceCents,
			...(pageCopy !== undefined ? { pageCopy } : {}),
		},
	};
}

/** Why an app cannot be published, or null when it can. */
export function publishEligibilityReason(behaviorType: string, hasDeployedCommit: boolean, paidCopy: boolean): string | null {
	if (paidCopy) return PAID_COPY_REASON;
	if (behaviorType !== 'think') return NOT_THINK_REASON;
	return hasDeployedCommit ? null : NOT_DEPLOYED_REASON;
}

/** The paid listing an app was copied from: its creator, or null once the listing is deleted. */
export interface PaidCopyOrigin {
	creatorUserId: string | null;
}

/** Whether an app is a copy of someone else's paid site, which stays private so the purchase isn't given away. */
export function isPaidCopy(origin: PaidCopyOrigin | null, ownerUserId: string): boolean {
	return origin !== null && origin.creatorUserId !== ownerUserId;
}

/**
 * What publishing an app as public at `priceCents` does to its paid listing.
 * `textChanged`: the request's page text differs from the text last sent for review.
 */
export function planPublish(listing: ListingState | null, priceCents: number, textChanged = false): PublishPlan {
	if (priceCents === 0) return { kind: 'free', unlistListing: listing?.status === 'listed' };
	if (!listing || listing.status === 'unlisted') return { kind: 'paid', submitVersion: true, listListing: true };
	if (listing.pendingPriceCents !== null) {
		return listing.pendingPriceCents === priceCents && !textChanged
			? { kind: 'paid', submitVersion: false, listListing: false }
			: { kind: 'conflict', error: VERSION_IN_REVIEW_ERROR };
	}
	const approvedAtThisPrice = listing.currentVersionId !== null && listing.priceCents === priceCents;
	return { kind: 'paid', submitVersion: !approvedAtThisPrice || textChanged, listListing: false };
}

/** Whether a user can start a new app from a site, and which files it copies. */
export function reuseDecision(input: ReuseInput): ReuseDecision {
	if (input.visibility !== 'public' || input.removedFromDiscover) {
		return { ok: false, status: 404, error: SITE_UNAVAILABLE_MESSAGE };
	}
	if (input.listing?.status === 'listed') {
		const versionId = input.listing.currentVersionId;
		if (!versionId) return { ok: false, status: 409, error: SITE_NOT_YET_AVAILABLE_MESSAGE };
		if (!input.isOwner && !input.hasPurchase) {
			return { ok: false, status: 402, error: SITE_PURCHASE_REQUIRED_MESSAGE };
		}
		return { ok: true, source: 'snapshot', versionId };
	}
	if (!input.isThink || !input.deployedCommit) {
		return { ok: false, status: 400, error: SITE_NOT_REUSABLE_MESSAGE };
	}
	return { ok: true, source: 'live', commit: input.deployedCommit };
}

/** Whether a viewer may read and clone an app's source: a listed paid listing limits it to the owner and buyers. */
export function canReadSource(input: SourceAccessInput): boolean {
	if (input.isOwner) return true;
	if (input.visibility !== 'public') return false;
	return input.paidListingListed ? input.hasPurchase : true;
}

export function parseDiscoverRemoval(body: unknown): Validation<DiscoverRemoval> {
	const removed = field(body, 'removed');
	if (removed === false) return { ok: true, value: { removed: false } };
	if (removed !== true) return { ok: false, error: 'removed must be true or false' };
	const rawReason = field(body, 'reason');
	const reason = typeof rawReason === 'string' ? rawReason.trim() : '';
	if (reason.length === 0) return { ok: false, error: 'A reason is required to remove a site from Discover' };
	if (reason.length > MAX_REJECTION_REASON_LENGTH) {
		return { ok: false, error: `Keep the reason under ${MAX_REJECTION_REASON_LENGTH} characters` };
	}
	return { ok: true, value: { removed: true, reason } };
}

/** Discover's category, pricing and reusable filters from a query string. */
export function parseDiscoverFilters(params: URLSearchParams): Validation<DiscoverFilters> {
	const category = params.get('category');
	if (category !== null && category !== '' && !isTemplateCategory(category)) {
		return { ok: false, error: 'Unknown category' };
	}
	const pricing = DISCOVER_PRICING_FILTERS.find((value) => value === (params.get('pricing') ?? 'all'));
	if (!pricing) return { ok: false, error: 'pricing must be all, free or paid' };
	const reusable = params.get('reusableOnly');
	const showcased = params.get('showcasedOnly');
	return {
		ok: true,
		value: {
			category: isTemplateCategory(category) ? category : null,
			pricing,
			reusableOnly: reusable === 'true' || reusable === '1',
			showcasedOnly: showcased === 'true' || showcased === '1',
		},
	};
}

/** An admin showing a store on the landing page, or taking it off. */
export function parseShowcaseChange(body: unknown): Validation<{ showcased: boolean }> {
	const showcased = field(body, 'showcased');
	return typeof showcased === 'boolean' ? { ok: true, value: { showcased } } : { ok: false, error: 'showcased must be true or false' };
}
