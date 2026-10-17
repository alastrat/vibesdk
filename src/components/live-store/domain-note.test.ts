import { describe, expect, it } from 'vitest';
import { connectedDomainNote } from './domain-note';

describe('a connected domain in the Go live panel', () => {
	it("shows the domain's address only while the store is live", () => {
		expect(connectedDomainNote('live')).toEqual({ showAddress: true, note: null });
	});

	it("says when a store that isn't live will be served on it", () => {
		expect(connectedDomainNote('unpublished')).toEqual({ showAddress: false, note: 'Your store opens on this domain once you publish it.' });
		expect(connectedDomainNote('offline')).toEqual({ showAddress: false, note: 'Your store is offline. It opens on this domain again once you publish it.' });
	});
});
