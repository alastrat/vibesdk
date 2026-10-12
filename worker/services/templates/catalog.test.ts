import { describe, expect, it } from 'vitest';
import { formatTemplatePrice } from '../../../shared/types/templates';
import {
	NOT_DEPLOYED_REASON,
	NOT_THINK_REASON,
	RIGHTS_REQUIRED_ERROR,
	canReview,
	canSubmitNewVersion,
	canUseTemplate,
	canWithdraw,
	eligibilityReason,
	isTemplateShotKind,
	isTemplateSlug,
	listingDecision,
	parseListingRequest,
	parseRejectionReason,
	parseRightsConfirmation,
	parseTemplateMetadata,
	purchaseDecision,
	randomSlugSuffix,
	slugifyTemplateName,
	supersededVersionId,
	uniqueTemplateSlug,
} from './catalog';

const VALID = { name: 'Fernwood', description: 'A cozy merino sock store.', category: 'store', priceCents: 0 };

describe('parseTemplateMetadata', () => {
	it('trims and accepts a complete form', () => {
		expect(
			parseTemplateMetadata({
				name: '  Fernwood Socks ',
				description: ' A cozy merino sock store. ',
				category: 'store',
				priceCents: 2900,
			}),
		).toEqual({
			ok: true,
			value: { name: 'Fernwood Socks', description: 'A cozy merino sock store.', category: 'store', priceCents: 2900 },
		});
	});

	it('treats a missing price as free', () => {
		const { priceCents: _omitted, ...withoutPrice } = VALID;
		expect(parseTemplateMetadata(withoutPrice)).toMatchObject({ ok: true, value: { priceCents: 0 } });
	});

	it.each([
		[{ ...VALID, name: 'ab' }, 'Name must be between 3 and 60 characters'],
		[{ ...VALID, name: 'x'.repeat(61) }, 'Name must be between 3 and 60 characters'],
		[{ ...VALID, description: 'Too short' }, 'Description must be between 10 and 280 characters'],
		[{ ...VALID, description: 'x'.repeat(281) }, 'Description must be between 10 and 280 characters'],
		[{ ...VALID, category: 'blog' }, 'Choose a category'],
		[{ ...VALID, priceCents: 1234 }, 'Choose a price'],
		[{ ...VALID, priceCents: '2900' }, 'Choose a price'],
		[null, 'Name must be between 3 and 60 characters'],
	])('rejects %j', (body, error) => {
		expect(parseTemplateMetadata(body)).toEqual({ ok: false, error });
	});
});

describe('prices and purchases', () => {
	it('formats prices', () => {
		expect(formatTemplatePrice(0)).toBe('Free');
		expect(formatTemplatePrice(2900)).toBe('$29');
		expect(formatTemplatePrice(950)).toBe('$9.50');
	});

	it.each([
		[{ priceCents: 0, isCreator: false, hasPurchase: false }, true],
		[{ priceCents: 2900, isCreator: false, hasPurchase: false }, false],
		[{ priceCents: 2900, isCreator: false, hasPurchase: true }, true],
		[{ priceCents: 2900, isCreator: true, hasPurchase: false }, true],
	])('decides use for %j', (input, allowed) => {
		expect(canUseTemplate(input)).toBe(allowed);
	});

	it.each([
		[{ priceCents: 0, isCreator: false, hasPurchase: false }, { ok: false, status: 400, error: 'This template is free' }],
		[{ priceCents: 2900, isCreator: true, hasPurchase: false }, { ok: false, status: 400, error: 'You created this template' }],
		[{ priceCents: 2900, isCreator: false, hasPurchase: true }, { ok: true, alreadyOwned: true }],
		[{ priceCents: 2900, isCreator: false, hasPurchase: false }, { ok: true, alreadyOwned: false }],
	])('decides a purchase for %j', (input, decision) => {
		expect(purchaseDecision(input)).toEqual(decision);
	});
});

describe('parseRightsConfirmation', () => {
	it('requires the literal true', () => {
		expect(parseRightsConfirmation({ rightsConfirmed: true })).toEqual({ ok: true, value: true });
		expect(parseRightsConfirmation({ rightsConfirmed: 'true' })).toEqual({ ok: false, error: RIGHTS_REQUIRED_ERROR });
		expect(parseRightsConfirmation({})).toEqual({ ok: false, error: RIGHTS_REQUIRED_ERROR });
	});
});

describe('slugs', () => {
	it.each([
		['Fernwood Merino Socks!', 'fernwood-merino-socks'],
		['Café Olé', 'cafe-ole'],
		['日本語', 'template'],
		['a'.repeat(47) + ' b', 'a'.repeat(47)],
	])('slugifies %s', (name, slug) => {
		expect(slugifyTemplateName(name)).toBe(slug);
	});

	it('uses the plain slug when it is free', async () => {
		await expect(uniqueTemplateSlug('Pluriza Home', async () => false)).resolves.toBe('pluriza-home');
	});

	it('adds a suffix when the slug is taken', async () => {
		const taken = new Set(['pluriza-home']);
		await expect(uniqueTemplateSlug('Pluriza Home', async (slug) => taken.has(slug), () => 'k3x9')).resolves.toBe(
			'pluriza-home-k3x9',
		);
	});

	it('gives up after five taken suffixes', async () => {
		await expect(uniqueTemplateSlug('Pluriza Home', async () => true, () => 'aaaa')).rejects.toThrow(
			'Could not find a free template slug',
		);
	});

	it('suffixes a reserved route name even when it is free', async () => {
		await expect(uniqueTemplateSlug('Mine', async () => false, () => 'k3x9')).resolves.toBe('mine-k3x9');
	});

	it('makes 4-character lowercase suffixes', () => {
		expect(randomSlugSuffix()).toMatch(/^[a-z0-9]{4}$/);
	});

	it('recognizes valid slugs', () => {
		expect(isTemplateSlug('fernwood-socks-k3x9')).toBe(true);
		expect(isTemplateSlug('Fernwood')).toBe(false);
		expect(isTemplateSlug('a--b')).toBe(false);
		expect(isTemplateSlug('../x')).toBe(false);
	});

	it('rejects a reserved route name as a slug', () => {
		expect(isTemplateSlug('mine')).toBe(false);
	});
});

describe('version rules', () => {
	it('explains why an app cannot be submitted', () => {
		expect(eligibilityReason('phasic', true)).toBe(NOT_THINK_REASON);
		expect(eligibilityReason('think', false)).toBe(NOT_DEPLOYED_REASON);
		expect(eligibilityReason('think', true)).toBeNull();
	});

	it('refuses a new version while one is in review', () => {
		expect(canSubmitNewVersion([])).toBe(true);
		expect(canSubmitNewVersion(['approved', 'rejected', 'withdrawn'])).toBe(true);
		expect(canSubmitNewVersion(['approved', 'pending'])).toBe(false);
	});

	it('withdraws and reviews only pending versions', () => {
		expect(canWithdraw('pending')).toBe(true);
		expect(canWithdraw('approved')).toBe(false);
		expect(canReview('pending')).toBe(true);
		expect(canReview('rejected')).toBe(false);
	});

	it('requires a rejection reason', () => {
		expect(parseRejectionReason({ reason: '  Uses a real brand logo ' })).toEqual({ ok: true, value: 'Uses a real brand logo' });
		expect(parseRejectionReason({ reason: '   ' })).toEqual({ ok: false, error: 'A reason is required to reject a template' });
		expect(parseRejectionReason({ reason: 'x'.repeat(501) })).toEqual({
			ok: false,
			error: 'Keep the reason under 500 characters',
		});
	});

	it('supersedes the current version only when it differs', () => {
		expect(supersededVersionId(null, 'v2')).toBeNull();
		expect(supersededVersionId('v1', 'v2')).toBe('v1');
		expect(supersededVersionId('v2', 'v2')).toBeNull();
	});
});

describe('listing', () => {
	it('parses the listed flag', () => {
		expect(parseListingRequest({ listed: false })).toEqual({ ok: true, value: false });
		expect(parseListingRequest({ listed: 'no' })).toEqual({ ok: false, error: 'listed must be true or false' });
	});

	it.each([
		[{ isAdmin: false, isCreator: false, listed: false, hasApprovedVersion: true }, { ok: false, status: 403, error: 'You can only change your own templates' }],
		[{ isAdmin: false, isCreator: true, listed: false, hasApprovedVersion: true }, { ok: true }],
		[{ isAdmin: false, isCreator: true, listed: true, hasApprovedVersion: true }, { ok: false, status: 403, error: 'Submit a new version to publish this template again' }],
		[{ isAdmin: true, isCreator: false, listed: true, hasApprovedVersion: false }, { ok: false, status: 400, error: 'This template has no approved version to publish' }],
		[{ isAdmin: true, isCreator: false, listed: true, hasApprovedVersion: true }, { ok: true }],
	])('decides %j', (input, decision) => {
		expect(listingDecision(input)).toEqual(decision);
	});

	it('knows the screenshot kinds', () => {
		expect(isTemplateShotKind('desktop')).toBe(true);
		expect(isTemplateShotKind('mobile')).toBe(true);
		expect(isTemplateShotKind('tablet')).toBe(false);
	});
});
