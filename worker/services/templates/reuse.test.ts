import { describe, expect, it } from 'vitest';
import {
	NOT_DEPLOYED_REASON,
	NOT_THINK_REASON,
	PAID_COPY_REASON,
	REUSE_CONSENT_REQUIRED_MESSAGE,
	SITE_NOT_REUSABLE_MESSAGE,
	SITE_NOT_YET_AVAILABLE_MESSAGE,
	SITE_PURCHASE_REQUIRED_MESSAGE,
	SITE_UNAVAILABLE_MESSAGE,
	canReadSource,
	isPaidCopy,
	parseDiscoverFilters,
	parseShowcaseChange,
	parseDiscoverRemoval,
	parsePublishRequest,
	planPublish,
	publishEligibilityReason,
	reuseDecision,
	type ListingState,
	type ReuseInput,
} from './reuse';
import { VERSION_IN_REVIEW_ERROR } from './catalog';

describe('parsePublishRequest', () => {
	it('makes an app private with nothing else', () => {
		expect(parsePublishRequest({ visibility: 'private' })).toEqual({ ok: true, value: { visibility: 'private' } });
	});

	it('requires consent to publish', () => {
		expect(parsePublishRequest({ visibility: 'public', priceCents: 0 })).toEqual({
			ok: false,
			error: REUSE_CONSENT_REQUIRED_MESSAGE,
		});
	});

	it('stores no category when none is chosen and treats a missing price as free', () => {
		expect(parsePublishRequest({ visibility: 'public', reuseConsent: true })).toEqual({
			ok: true,
			value: { visibility: 'public', category: null, priceCents: 0 },
		});
		expect(parsePublishRequest({ visibility: 'public', reuseConsent: true, category: null })).toEqual({
			ok: true,
			value: { visibility: 'public', category: null, priceCents: 0 },
		});
	});

	it('accepts a category and an allowed price', () => {
		expect(parsePublishRequest({ visibility: 'public', reuseConsent: true, category: 'store', priceCents: 2900 })).toEqual({
			ok: true,
			value: { visibility: 'public', category: 'store', priceCents: 2900 },
		});
	});

	it('rejects unknown categories, prices and visibilities', () => {
		expect(parsePublishRequest({ visibility: 'public', reuseConsent: true, category: 'blog' })).toEqual({
			ok: false,
			error: 'Choose a category',
		});
		expect(parsePublishRequest({ visibility: 'public', reuseConsent: true, priceCents: 1000 })).toEqual({
			ok: false,
			error: 'Choose a price',
		});
		expect(parsePublishRequest({ visibility: 'team' })).toEqual({
			ok: false,
			error: 'Visibility must be either "private" or "public"',
		});
	});
});

describe('publishEligibilityReason', () => {
	it('allows deployed Think apps only', () => {
		expect(publishEligibilityReason('think', true, false)).toBeNull();
		expect(publishEligibilityReason('think', false, false)).toBe(NOT_DEPLOYED_REASON);
		expect(publishEligibilityReason('phasic', true, false)).toBe(NOT_THINK_REASON);
	});

	it('keeps a copy of a paid site private even before it is deployed', () => {
		expect(publishEligibilityReason('think', true, true)).toBe(PAID_COPY_REASON);
		expect(publishEligibilityReason('think', false, true)).toBe(PAID_COPY_REASON);
	});
});

describe('isPaidCopy', () => {
	it('is false for an app not copied from a paid version', () => {
		expect(isPaidCopy(null, 'buyer')).toBe(false);
	});

	it("is true for a copy of another creator's paid site", () => {
		expect(isPaidCopy({ creatorUserId: 'seller' }, 'buyer')).toBe(true);
	});

	it('is false for a creator copying their own paid site', () => {
		expect(isPaidCopy({ creatorUserId: 'seller' }, 'seller')).toBe(false);
	});

	it('stays true after the paid listing is deleted', () => {
		expect(isPaidCopy({ creatorUserId: null }, 'buyer')).toBe(true);
	});
});

describe('planPublish', () => {
	const approved: ListingState = { status: 'listed', currentVersionId: 'v1', priceCents: 2900, pendingPriceCents: null };

	it('publishes free with nothing to unlist when there is no listing', () => {
		expect(planPublish(null, 0)).toEqual({ kind: 'free', unlistListing: false });
	});

	it('unlists a listed paid listing when the owner switches to free', () => {
		expect(planPublish(approved, 0)).toEqual({ kind: 'free', unlistListing: true });
	});

	it('submits and lists on the first paid publish', () => {
		expect(planPublish(null, 2900)).toEqual({ kind: 'paid', submitVersion: true, listListing: true });
	});

	it('asks for a new review when a free site goes back to paid', () => {
		expect(planPublish({ ...approved, status: 'unlisted' }, 2900)).toEqual({
			kind: 'paid',
			submitVersion: true,
			listListing: true,
		});
	});

	it('changes nothing for an approved listing at the same price', () => {
		expect(planPublish(approved, 2900)).toEqual({ kind: 'paid', submitVersion: false, listListing: false });
	});

	it('submits a new version for a new price', () => {
		expect(planPublish(approved, 4900)).toEqual({ kind: 'paid', submitVersion: true, listListing: false });
	});

	it('resubmits a listing whose first version was rejected', () => {
		expect(planPublish({ status: 'listed', currentVersionId: null, priceCents: 0, pendingPriceCents: null }, 900)).toEqual({
			kind: 'paid',
			submitVersion: true,
			listListing: false,
		});
	});

	it('keeps a version in review at its price and refuses a different one', () => {
		const inReview: ListingState = { ...approved, pendingPriceCents: 4900 };
		expect(planPublish(inReview, 4900)).toEqual({ kind: 'paid', submitVersion: false, listListing: false });
		expect(planPublish(inReview, 1900)).toEqual({ kind: 'conflict', error: VERSION_IN_REVIEW_ERROR });
	});
});

describe('reuseDecision', () => {
	const free: ReuseInput = {
		visibility: 'public',
		removedFromDiscover: false,
		isThink: true,
		deployedCommit: 'abc',
		listing: null,
		isOwner: false,
		hasPurchase: false,
	};

	it('copies the latest deploy of a free site', () => {
		expect(reuseDecision(free)).toEqual({ ok: true, source: 'live', commit: 'abc' });
	});

	it('copies a free site whose paid listing is unlisted', () => {
		expect(reuseDecision({ ...free, listing: { status: 'unlisted', currentVersionId: 'v1' } })).toEqual({
			ok: true,
			source: 'live',
			commit: 'abc',
		});
	});

	it('hides private sites, even from their owner', () => {
		expect(reuseDecision({ ...free, visibility: 'private', isOwner: true })).toEqual({
			ok: false,
			status: 404,
			error: SITE_UNAVAILABLE_MESSAGE,
		});
	});

	it('hides removed sites', () => {
		expect(reuseDecision({ ...free, removedFromDiscover: true })).toEqual({
			ok: false,
			status: 404,
			error: SITE_UNAVAILABLE_MESSAGE,
		});
	});

	it('refuses free sites that are not deployed Think apps', () => {
		expect(reuseDecision({ ...free, isThink: false })).toEqual({ ok: false, status: 400, error: SITE_NOT_REUSABLE_MESSAGE });
		expect(reuseDecision({ ...free, deployedCommit: null })).toEqual({
			ok: false,
			status: 400,
			error: SITE_NOT_REUSABLE_MESSAGE,
		});
	});

	it('keeps a paid site unusable until its first approval, even for the owner', () => {
		const pending: ReuseInput = { ...free, isOwner: true, listing: { status: 'listed', currentVersionId: null } };
		expect(reuseDecision(pending)).toEqual({ ok: false, status: 409, error: SITE_NOT_YET_AVAILABLE_MESSAGE });
	});

	it('asks for a purchase of an approved paid site', () => {
		const paid: ReuseInput = { ...free, listing: { status: 'listed', currentVersionId: 'v2' } };
		expect(reuseDecision(paid)).toEqual({ ok: false, status: 402, error: SITE_PURCHASE_REQUIRED_MESSAGE });
		expect(reuseDecision({ ...paid, hasPurchase: true })).toEqual({ ok: true, source: 'snapshot', versionId: 'v2' });
		expect(reuseDecision({ ...paid, isOwner: true })).toEqual({ ok: true, source: 'snapshot', versionId: 'v2' });
	});

	it('copies the approved snapshot of a paid site even after the source stops being a deployed Think app', () => {
		const paid: ReuseInput = {
			...free,
			isThink: false,
			deployedCommit: null,
			hasPurchase: true,
			listing: { status: 'listed', currentVersionId: 'v2' },
		};
		expect(reuseDecision(paid)).toEqual({ ok: true, source: 'snapshot', versionId: 'v2' });
	});
});

describe('canReadSource', () => {
	const visitor = { visibility: 'public', isOwner: false, paidListingListed: false, hasPurchase: false } as const;

	it('lets the owner read the source of any app', () => {
		expect(canReadSource({ ...visitor, isOwner: true })).toBe(true);
		expect(canReadSource({ ...visitor, isOwner: true, visibility: 'private' })).toBe(true);
		expect(canReadSource({ ...visitor, isOwner: true, paidListingListed: true })).toBe(true);
	});

	it('hides a private app from everyone else', () => {
		expect(canReadSource({ ...visitor, visibility: 'private' })).toBe(false);
		expect(canReadSource({ ...visitor, visibility: 'private', hasPurchase: true })).toBe(false);
	});

	it('shows a public app without a listed paid listing to anyone', () => {
		expect(canReadSource(visitor)).toBe(true);
	});

	it('shows a public app with a listed paid listing to its buyers only', () => {
		expect(canReadSource({ ...visitor, paidListingListed: true })).toBe(false);
		expect(canReadSource({ ...visitor, paidListingListed: true, hasPurchase: true })).toBe(true);
	});
});

describe('parseDiscoverRemoval', () => {
	it('requires a reason to remove and none to restore', () => {
		expect(parseDiscoverRemoval({ removed: true, reason: '  Copied brand  ' })).toEqual({
			ok: true,
			value: { removed: true, reason: 'Copied brand' },
		});
		expect(parseDiscoverRemoval({ removed: true })).toEqual({
			ok: false,
			error: 'A reason is required to remove a site from Discover',
		});
		expect(parseDiscoverRemoval({ removed: false })).toEqual({ ok: true, value: { removed: false } });
		expect(parseDiscoverRemoval({})).toEqual({ ok: false, error: 'removed must be true or false' });
	});

	it('caps the reason length', () => {
		expect(parseDiscoverRemoval({ removed: true, reason: 'x'.repeat(501) })).toEqual({
			ok: false,
			error: 'Keep the reason under 500 characters',
		});
	});
});

describe('parseDiscoverFilters', () => {
	it('defaults to every category, all prices and every site', () => {
		expect(parseDiscoverFilters(new URLSearchParams())).toEqual({
			ok: true,
			value: { category: null, pricing: 'all', reusableOnly: false, showcasedOnly: false },
		});
	});

	it('reads category, pricing, the reusable flag and the showcased flag', () => {
		expect(parseDiscoverFilters(new URLSearchParams('category=store&pricing=paid&reusableOnly=true&showcasedOnly=true'))).toEqual({
			ok: true,
			value: { category: 'store', pricing: 'paid', reusableOnly: true, showcasedOnly: true },
		});
	});

	it('rejects unknown values', () => {
		expect(parseDiscoverFilters(new URLSearchParams('category=blog'))).toEqual({ ok: false, error: 'Unknown category' });
		expect(parseDiscoverFilters(new URLSearchParams('pricing=cheap'))).toEqual({
			ok: false,
			error: 'pricing must be all, free or paid',
		});
	});
});

describe('parseShowcaseChange', () => {
	it('accepts showing or hiding a store on the landing page', () => {
		expect(parseShowcaseChange({ showcased: true })).toEqual({ ok: true, value: { showcased: true } });
		expect(parseShowcaseChange({ showcased: false })).toEqual({ ok: true, value: { showcased: false } });
	});

	it('rejects anything else', () => {
		for (const body of [{}, { showcased: 'yes' }, null, 'true']) {
			expect(parseShowcaseChange(body)).toEqual({ ok: false, error: 'showcased must be true or false' });
		}
	});
});

describe('page text in publish requests', () => {
	const COPY = {
		tagline: 'A calm site',
		about: ['About it.'],
		features: ['a', 'b', 'c'],
		includes: [{ name: 'Home', detail: 'The one page' }],
		madeFor: ['Studios', 'Teachers'],
	};
	const BASE = { visibility: 'public', reuseConsent: true, category: 'landing', priceCents: 0 };

	it('keeps the saved text when a request has no pageCopy', () => {
		const parsed = parsePublishRequest(BASE);
		expect(parsed.ok && parsed.value.visibility === 'public' && 'pageCopy' in parsed.value).toBe(false);
	});

	it('accepts valid text, a clear, and rejects text that breaks a rule', () => {
		expect(parsePublishRequest({ ...BASE, pageCopy: COPY })).toEqual({
			ok: true,
			value: { visibility: 'public', category: 'landing', priceCents: 0, pageCopy: COPY },
		});
		expect(parsePublishRequest({ ...BASE, pageCopy: null })).toEqual({
			ok: true,
			value: { visibility: 'public', category: 'landing', priceCents: 0, pageCopy: null },
		});
		expect(parsePublishRequest({ ...BASE, pageCopy: { ...COPY, features: ['one'] } })).toEqual({
			ok: false,
			error: 'List 3 to 8 features',
		});
	});
});

describe('planPublish with page text', () => {
	const APPROVED = { status: 'listed' as const, currentVersionId: 'v1', priceCents: 2900, pendingPriceCents: null };

	it('sends an approved paid site back to review when only its text changed', () => {
		expect(planPublish(APPROVED, 2900, false)).toEqual({ kind: 'paid', submitVersion: false, listListing: false });
		expect(planPublish(APPROVED, 2900, true)).toEqual({ kind: 'paid', submitVersion: true, listListing: false });
	});

	it('refuses a text change while a version is in review', () => {
		const pending = { ...APPROVED, pendingPriceCents: 2900 };
		expect(planPublish(pending, 2900, false)).toEqual({ kind: 'paid', submitVersion: false, listListing: false });
		expect(planPublish(pending, 2900, true)).toEqual({ kind: 'conflict', error: VERSION_IN_REVIEW_ERROR });
	});

	it('ignores text for free sites', () => {
		expect(planPublish(APPROVED, 0, true)).toEqual({ kind: 'free', unlistListing: true });
	});
});
