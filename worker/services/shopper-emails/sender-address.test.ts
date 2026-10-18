import { describe, expect, it } from 'vitest';
import { storeSenderAddress } from './sender-address';

describe("a store's sender address", () => {
	it("is the store's slug on the shopper email domain", () => {
		expect(storeSenderAddress('northwind-tea', 'no-reply@orders.estori.app')).toBe('northwind-tea@orders.estori.app');
	});

	it('steps around mailbox names that belong to the domain itself', () => {
		expect(storeSenderAddress('support', 'no-reply@orders.estori.app')).toBe('support-store@orders.estori.app');
		expect(storeSenderAddress('postmaster', 'no-reply@orders.estori.app')).toBe('postmaster-store@orders.estori.app');
		expect(storeSenderAddress('no-reply', 'no-reply@orders.estori.app')).toBe('no-reply-store@orders.estori.app');
	});

	it("uses the shared address for a store with no slug or one that can't be a mailbox name", () => {
		expect(storeSenderAddress(null, 'no-reply@orders.estori.app')).toBe('no-reply@orders.estori.app');
		expect(storeSenderAddress('Bad Slug!', 'no-reply@orders.estori.app')).toBe('no-reply@orders.estori.app');
		expect(storeSenderAddress('a'.repeat(65), 'no-reply@orders.estori.app')).toBe('no-reply@orders.estori.app');
	});

	it("keeps every store on Estori's no-reply address until a shopper email domain is set", () => {
		expect(storeSenderAddress('northwind-tea', null)).toBe('no-reply@estori.app');
	});
});
