import { describe, expect, it } from 'vitest';
import {
	canReview,
	canSubmitNewVersion,
	canWithdraw,
	isTemplateCategory,
	isTemplatePrice,
	isTemplateShotKind,
	paidUpdatePrice,
	parseRejectionReason,
	purchaseDecision,
	supersededVersionId,
} from './catalog';
import { TEMPLATE_PRICE_OPTIONS_CENTS, formatTemplatePrice } from '../../../shared/types/templates';

describe('isTemplateCategory and isTemplatePrice', () => {
	it('accepts only the listed values', () => {
		expect(isTemplateCategory('restaurant')).toBe(true);
		expect(isTemplateCategory('blog')).toBe(false);
		expect(isTemplatePrice(0)).toBe(true);
		expect(isTemplatePrice(4900)).toBe(true);
		expect(isTemplatePrice(1000)).toBe(false);
		expect(isTemplatePrice('900')).toBe(false);
	});
});

describe('purchaseDecision', () => {
	it('sells approved paid sites to others and keeps an earlier purchase', () => {
		expect(purchaseDecision({ priceCents: 2900, isCreator: false, hasPurchase: false })).toEqual({
			ok: true,
			alreadyOwned: false,
		});
		expect(purchaseDecision({ priceCents: 2900, isCreator: false, hasPurchase: true })).toEqual({
			ok: true,
			alreadyOwned: true,
		});
	});

	it('refuses free sites and the creator', () => {
		expect(purchaseDecision({ priceCents: 0, isCreator: false, hasPurchase: false })).toEqual({
			ok: false,
			status: 400,
			error: 'This site is free',
		});
		expect(purchaseDecision({ priceCents: 2900, isCreator: true, hasPurchase: false })).toEqual({
			ok: false,
			status: 400,
			error: 'You published this site',
		});
	});
});

describe('version state rules', () => {
	it('allows one version in review at a time', () => {
		expect(canSubmitNewVersion(['approved', 'rejected'])).toBe(true);
		expect(canSubmitNewVersion(['approved', 'pending'])).toBe(false);
	});

	it('withdraws and reviews only pending versions', () => {
		expect(canWithdraw('pending')).toBe(true);
		expect(canWithdraw('approved')).toBe(false);
		expect(canReview('pending')).toBe(true);
		expect(canReview('withdrawn')).toBe(false);
	});

	it('supersedes the current version only when another one is approved', () => {
		expect(supersededVersionId('v1', 'v2')).toBe('v1');
		expect(supersededVersionId('v2', 'v2')).toBeNull();
		expect(supersededVersionId(null, 'v2')).toBeNull();
	});
});

describe('paidUpdatePrice', () => {
	it('keeps the approved price after a higher price is rejected', () => {
		expect(
			paidUpdatePrice({ currentVersionId: 'v1', priceCents: 1900 }, [
				{ status: 'rejected', priceCents: 4900 },
				{ status: 'approved', priceCents: 1900 },
			]),
		).toBe(1900);
	});

	it('asks the newest price again before the first approval', () => {
		expect(paidUpdatePrice({ currentVersionId: null, priceCents: 0 }, [{ status: 'rejected', priceCents: 4900 }])).toBe(
			4900,
		);
	});

	it('falls back to the listing price when there are no versions', () => {
		expect(paidUpdatePrice({ currentVersionId: null, priceCents: 0 }, [])).toBe(0);
	});
});

describe('parseRejectionReason', () => {
	it('requires a trimmed reason under 500 characters', () => {
		expect(parseRejectionReason({ reason: '  Copied brand  ' })).toEqual({ ok: true, value: 'Copied brand' });
		expect(parseRejectionReason({ reason: '   ' })).toEqual({
			ok: false,
			error: 'A reason is required to reject this version',
		});
		expect(parseRejectionReason({ reason: 'x'.repeat(501) })).toEqual({
			ok: false,
			error: 'Keep the reason under 500 characters',
		});
	});
});

describe('isTemplateShotKind', () => {
	it('names the two screenshots', () => {
		expect(isTemplateShotKind('desktop')).toBe(true);
		expect(isTemplateShotKind('mobile')).toBe(true);
		expect(isTemplateShotKind('tablet')).toBe(false);
	});
});

describe('formatTemplatePrice', () => {
	it('formats free and whole-dollar prices', () => {
		expect(formatTemplatePrice(0)).toBe('Free');
		expect(formatTemplatePrice(2900)).toBe('$29');
		expect(formatTemplatePrice(950)).toBe('$9.50');
	});

	it('groups thousands, as formatUsd does', () => {
		expect(formatTemplatePrice(100_000)).toBe('$1,000');
		expect(formatTemplatePrice(123_450)).toBe('$1,234.50');
		expect(formatTemplatePrice(123_450, 'pt-BR')).toBe('US$\u00a01.234,50');
	});

	it('keeps every price option a creator can choose as it was', () => {
		expect(TEMPLATE_PRICE_OPTIONS_CENTS.map((cents) => formatTemplatePrice(cents))).toEqual(['Free', '$9', '$19', '$29', '$49']);
		expect(formatTemplatePrice(-100)).toBe('Free');
	});

	it('writes a paid price the way the language writes dollars', () => {
		expect(formatTemplatePrice(2900, 'es')).toBe('USD\u00a029');
		expect(formatTemplatePrice(950, 'es')).toBe('USD\u00a09.50');
		expect(formatTemplatePrice(950, 'pt-BR')).toBe('US$\u00a09,50');
		expect(formatTemplatePrice(4900, 'pt-BR')).toBe('US$\u00a049');
	});

	it('leaves the word for free to the caller, who has the translated catalog', () => {
		expect(formatTemplatePrice(0, 'es')).toBe('Free');
		expect(formatTemplatePrice(0, 'es', 'Gratis')).toBe('Gratis');
		expect(formatTemplatePrice(0, 'pt-BR', 'Grátis')).toBe('Grátis');
		expect(formatTemplatePrice(2900, 'es', 'Gratis')).toBe('USD\u00a029');
	});
});
