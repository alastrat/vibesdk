import { describe, expect, it } from 'vitest';
import { connectedDomainNote, domainNeedsRecords } from './domain-note';

describe('a connected domain in the Go live panel', () => {
	it("shows the domain's address only while the store is live", () => {
		expect(connectedDomainNote('live')).toEqual({ showAddress: true, note: null });
	});

	it("says when a store that isn't live will be served on it", () => {
		expect(connectedDomainNote('unpublished')).toEqual({ showAddress: false, note: 'Your store opens on this domain once you publish it.' });
		expect(connectedDomainNote('offline')).toEqual({ showAddress: false, note: 'Your store is offline. It opens on this domain again once you publish it.' });
	});
});

describe("a domain's DNS records in the Go live panel", () => {
	it('are shown until the domain connects, and again whenever a connected domain has a warning', () => {
		expect(domainNeedsRecords({ status: 'pending', lastError: null })).toBe(true);
		expect(domainNeedsRecords({ status: 'failed', lastError: 'Gave up.' })).toBe(true);
		expect(domainNeedsRecords({ status: 'active', lastError: null })).toBe(false);
		expect(domainNeedsRecords({ status: 'active', lastError: "We can't see this domain's DNS records right now." })).toBe(true);
	});
});
