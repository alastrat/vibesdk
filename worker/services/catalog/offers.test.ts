import { describe, expect, it } from 'vitest';
import { lockFromLookup } from './offers';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

describe('lockFromLookup', () => {
	const lookup = { catalogVariantId: 'cv_1', supplierVariantId: 'v1', offer: { available: true, catalogPriceCents: 2028, updatedAt: new Date(NOW - HOUR) } };

	it("locks an available offer's current price", () => {
		expect(lockFromLookup(lookup, 'cv_1', NOW)).toEqual({ ok: true, catalogVariantId: 'cv_1', supplier: 'cjdropshipping', supplierVariantId: 'v1', lockedCatalogPriceCents: 2028 });
	});

	it('refuses unknown variants, destinations without an offer, unavailable offers and stale prices', () => {
		expect(lockFromLookup(undefined, 'cv_x', NOW)).toEqual({ ok: false, catalogVariantId: 'cv_x', reason: 'unknown' });
		expect(lockFromLookup({ ...lookup, offer: null }, 'cv_1', NOW)).toEqual({ ok: false, catalogVariantId: 'cv_1', reason: 'ships_to_unsupported' });
		expect(lockFromLookup({ ...lookup, offer: { ...lookup.offer, available: false } }, 'cv_1', NOW)).toMatchObject({ ok: false, reason: 'unavailable' });
		expect(lockFromLookup({ ...lookup, offer: { ...lookup.offer, catalogPriceCents: null } }, 'cv_1', NOW)).toMatchObject({ ok: false, reason: 'unavailable' });
		expect(lockFromLookup({ ...lookup, offer: { ...lookup.offer, updatedAt: new Date(NOW - 73 * HOUR) } }, 'cv_1', NOW)).toMatchObject({ ok: false, reason: 'unavailable' });
	});
});
