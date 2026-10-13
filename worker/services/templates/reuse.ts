/**
 * Discover publishing and reuse rules:
 * - what a publish request asks for, and what publishing does to a paid listing;
 * - whether a site can be reused, and from which files;
 * - admin removal and Discover's filters.
 * Pure, so every rule is unit-tested.
 */

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

export const SITE_UNAVAILABLE_MESSAGE = 'This site is no longer available';
export const SITE_PURCHASE_REQUIRED_MESSAGE = 'Buy this site before using it';
export const SITE_NOT_YET_AVAILABLE_MESSAGE = "This site isn't available to use yet";
export const SITE_NOT_REUSABLE_MESSAGE = "This site can't be reused right now";
export const REUSE_CONSENT_REQUIRED_MESSAGE = 'Confirm that others may copy and adapt this site';
export const NOT_THINK_REASON = 'Only apps built with the current builder can be published';
export const NOT_DEPLOYED_REASON = 'Deploy your app before publishing it';
export const PUBLISHING_CHECK_FAILED_MESSAGE = "Couldn't check this app right now; try again";

export type PublishRequest =
	| { visibility: 'private' }
	| { visibility: 'public'; category: TemplateCategory | null; priceCents: number };

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

export type ReuseDecision =
	| { ok: true; source: 'live'; commit: string }
	| { ok: true; source: 'snapshot'; versionId: string }
	| { ok: false; status: 400 | 402 | 404 | 409; error: string };

export type DiscoverRemoval = { removed: true; reason: string } | { removed: false };

export interface DiscoverFilters {
	category: TemplateCategory | null;
	pricing: DiscoverPricing;
	reusableOnly: boolean;
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

	return {
		ok: true,
		value: { visibility: 'public', category: isTemplateCategory(category) ? category : null, priceCents },
	};
}

/** Why an app cannot be published, or null when it can. */
export function publishEligibilityReason(behaviorType: string, hasDeployedCommit: boolean): string | null {
	if (behaviorType !== 'think') return NOT_THINK_REASON;
	return hasDeployedCommit ? null : NOT_DEPLOYED_REASON;
}

/** What publishing an app as public at `priceCents` does to its paid listing. */
export function planPublish(listing: ListingState | null, priceCents: number): PublishPlan {
	if (priceCents === 0) return { kind: 'free', unlistListing: listing?.status === 'listed' };
	if (!listing || listing.status === 'unlisted') return { kind: 'paid', submitVersion: true, listListing: true };
	if (listing.pendingPriceCents !== null) {
		return listing.pendingPriceCents === priceCents
			? { kind: 'paid', submitVersion: false, listListing: false }
			: { kind: 'conflict', error: VERSION_IN_REVIEW_ERROR };
	}
	const approvedAtThisPrice = listing.currentVersionId !== null && listing.priceCents === priceCents;
	return { kind: 'paid', submitVersion: !approvedAtThisPrice, listListing: false };
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
	return {
		ok: true,
		value: {
			category: isTemplateCategory(category) ? category : null,
			pricing,
			reusableOnly: reusable === 'true' || reusable === '1',
		},
	};
}
