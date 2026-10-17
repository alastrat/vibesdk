import { describe, expect, it } from 'vitest';
import { customHostnameProblem, normalizeHostname, slugFromTitle, slugProblem, storeSubdomainSlug } from './live-stores';

const OWN = { storesDomain: 'estori.shop', estoriDomains: ['estori.app', 'preview.estori.app'] };

describe('store slugs', () => {
	it("suggests an address from the store's title", () => {
		expect(slugFromTitle('Northwind Tea Co.')).toBe('northwind-tea-co');
		expect(slugFromTitle('  Café  Olé — Paris ')).toBe('cafe-ole-paris');
		expect(slugFromTitle('A'.repeat(60))).toBe('a'.repeat(40));
		expect(slugFromTitle('Lumen Home', 'e0dcb2a3-0ea1')).toBe('lumen-home');
		// Nothing usable in the title: the app id makes one.
		expect(slugFromTitle('!!', 'e0dcb2a3-0ea1-488e')).toBe('store-e0dcb2a3');
		// A reserved word gets a suffix, so the suggestion is always allowed.
		expect(slugFromTitle('Shop', 'e0dcb2a3-0ea1')).toBe('shop-e0dcb2a3');
	});

	it('allows 3 to 40 lowercase letters, digits and inner hyphens, and no reserved word', () => {
		expect(slugProblem('northwind-tea')).toBeNull();
		expect(slugProblem('ab')).toBe('Use 3 to 40 lowercase letters, numbers or hyphens.');
		expect(slugProblem('-northwind')).toBe('Use 3 to 40 lowercase letters, numbers or hyphens.');
		expect(slugProblem('north--wind')).toBe('Use 3 to 40 lowercase letters, numbers or hyphens.');
		expect(slugProblem('Northwind')).toBe('Use 3 to 40 lowercase letters, numbers or hyphens.');
		expect(slugProblem('www')).toBe('That address is reserved. Try another.');
		expect(slugProblem('checkout')).toBe('That address is reserved. Try another.');
	});

	it('reads the slug of a host one label under the stores domain, and nothing deeper', () => {
		expect(storeSubdomainSlug('northwind-tea.estori.shop', 'estori.shop')).toBe('northwind-tea');
		expect(storeSubdomainSlug('NORTHWIND-TEA.estori.shop', 'estori.shop')).toBe('northwind-tea');
		expect(storeSubdomainSlug('a.b.estori.shop', 'estori.shop')).toBeNull();
		expect(storeSubdomainSlug('estori.shop', 'estori.shop')).toBeNull();
		expect(storeSubdomainSlug('northwind-tea.estori.app', 'estori.shop')).toBeNull();
		expect(storeSubdomainSlug('northwind-tea.stores.localhost', 'stores.localhost')).toBe('northwind-tea');
		expect(storeSubdomainSlug('northwind-tea.estori.shop', null)).toBeNull();
	});
});

describe('custom domains', () => {
	it('takes a domain however the seller pastes it', () => {
		expect(normalizeHostname('shop.NorthwindTea.com')).toBe('shop.northwindtea.com');
		expect(normalizeHostname(' https://shop.northwindtea.com/products?x=1 ')).toBe('shop.northwindtea.com');
		expect(normalizeHostname('shop.northwindtea.com.')).toBe('shop.northwindtea.com');
		expect(normalizeHostname('shop.northwindtea.com:8443')).toBe('shop.northwindtea.com');
		expect(normalizeHostname('')).toBeNull();
		expect(normalizeHostname('not a domain')).toBeNull();
	});

	it("refuses IP addresses, single names, bad labels, and Estori's own domains", () => {
		expect(customHostnameProblem('shop.northwindtea.com', OWN)).toBeNull();
		expect(customHostnameProblem('northwindtea', OWN)).toBe('Enter a full domain, such as shop.yourstore.com.');
		expect(customHostnameProblem('192.168.1.10', OWN)).toBe('Enter a full domain, such as shop.yourstore.com.');
		expect(customHostnameProblem('-shop.northwindtea.com', OWN)).toBe('Enter a full domain, such as shop.yourstore.com.');
		expect(customHostnameProblem(`${'a'.repeat(64)}.com`, OWN)).toBe('Enter a full domain, such as shop.yourstore.com.');
		expect(customHostnameProblem('northwind.estori.shop', OWN)).toBe("That's an Estori address. Enter a domain you own.");
		expect(customHostnameProblem('estori.app', OWN)).toBe("That's an Estori address. Enter a domain you own.");
		expect(customHostnameProblem('x.preview.estori.app', OWN)).toBe("That's an Estori address. Enter a domain you own.");
	});

	it("asks for a subdomain when given a root domain, which can't point at a store with a CNAME", () => {
		expect(customHostnameProblem('northwindtea.com', OWN)).toBe('Use a subdomain, such as shop.northwindtea.com. Root domains like northwindtea.com need a different DNS record, which isn\'t supported yet.');
		expect(customHostnameProblem('www.northwindtea.com', OWN)).toBeNull();
	});
});
