import { describe, expect, it } from 'vitest';
import { parseCheckoutRequest, safeReturnPath } from './request';

describe('safeReturnPath', () => {
	it('keeps a path on the store', () => {
		expect(safeReturnPath('/thanks', '/')).toBe('/thanks');
		expect(safeReturnPath('/orders/done?x=1', '/')).toBe('/orders/done?x=1');
	});

	it('normalizes a path so the redirect after payment always works', () => {
		expect(safeReturnPath('/thanks#top', '/')).toBe('/thanks');
		expect(safeReturnPath('/a/../../b', '/')).toBe('/b');
		expect(safeReturnPath('/caf\u00e9', '/')).toBe('/caf%C3%A9');
	});

	it('falls back for anything that could leave the store', () => {
		for (const value of ['//evil.example', 'https://evil.example', 'javascript:alert(1)', '/a\\b', '/a\nb', `/${'a'.repeat(200)}`, 42, undefined]) {
			expect(safeReturnPath(value, '/')).toBe('/');
		}
	});
});

describe('safeReturnPath and control characters', () => {
	it('falls back for a path with any control character, and keeps one with a space', () => {
		for (const character of ['\u0000', '\t', '\n', '\u001f', '\u007f']) {
			expect(safeReturnPath(`/thanks${character}/x`, '/'), JSON.stringify(character)).toBe('/');
		}
		expect(safeReturnPath('/thank you', '/')).toBe('/thank%20you');
	});
});

describe('parseCheckoutRequest', () => {
	const VALID = { items: [{ variantId: 'trail-mug-blue', quantity: 2 }], shipTo: 'us', successPath: '/thanks', cancelPath: '/cart', note: 'Gift' };

	it('reads variant ids, quantities, the country, return paths and a note', () => {
		expect(parseCheckoutRequest(VALID)).toEqual({ ...VALID, shipTo: 'US' });
		expect(parseCheckoutRequest({ items: VALID.items, shipTo: 'CA' })).toEqual({ items: VALID.items, shipTo: 'CA' });
	});

	it('refuses amounts, prices, fees and accounts anywhere in the body', () => {
		expect(parseCheckoutRequest({ ...VALID, amount: 100 })).toBeNull();
		expect(parseCheckoutRequest({ ...VALID, account: 'acct_1' })).toBeNull();
		expect(parseCheckoutRequest({ ...VALID, items: [{ variantId: 'trail-mug-blue', quantity: 1, price: 1 }] })).toBeNull();
		expect(parseCheckoutRequest({ ...VALID, fee: 0 })).toBeNull();
	});

	it('refuses an empty or oversized cart and malformed fields', () => {
		expect(parseCheckoutRequest({ ...VALID, items: [] })).toBeNull();
		expect(parseCheckoutRequest({ ...VALID, items: Array.from({ length: 51 }, (_, index) => ({ variantId: `v-${index}`, quantity: 1 })) })).toBeNull();
		expect(parseCheckoutRequest({ ...VALID, shipTo: 'USA' })).toBeNull();
		expect(parseCheckoutRequest({ ...VALID, note: 'x'.repeat(501) })).toBeNull();
		expect(parseCheckoutRequest('items')).toBeNull();
	});
});
